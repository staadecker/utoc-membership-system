const { google } = require("googleapis");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const sendGridClient = require("@sendgrid/mail");

// region Constants
const secretIds = {
  production: "",
  development:
    "projects/620400297419/secrets/mailing-list-synchronizer-config/versions/latest",
};

const NO_REPLY_EMAIL = "no-reply@utoc.ca";

/**
 * The values to these variables are loaded from Google Cloud Secret manager when the function is run
 */
const Config = {
  googleSheetsServiceAccountKey: null,
  googleSheetsServiceAccountEmail: null,
  directoryApiServiceAccountEmail: null,
  directoryApiServiceAccountKey: null,
  googleGroupEmail: null,
  adminEmail: null,
  databaseSpreadsheetId: null,
  sendGridApiKey: null,
  removeEmailTemplateId: "d-b23a2ee67d8f4f78bda907112024537a",
};

// endregion

// region Helpers
/**
 * Returns the secret id based on the environment
 */
const getSecretId = () => {
  switch (process.env.ENVIRONMENT) {
    case "production":
      return secretIds.production;
    case "development":
      return secretIds.development;
    case "test":
      return null;
    default:
      throw new Error("Unknown environment");
  }
};

/**
 * Replaces all the nulls in the Config variable with the value stored in the Google Secret manager
 */
// noinspection DuplicatedCode
const loadConfigFromGoogleSecretManager = async () => {
  const secretId = getSecretId();

  // Exit if no secret ID (happens during unit tests)
  if (!secretId) return;

  // Read JSON secret from Google Cloud Secret Manager
  const client = new SecretManagerServiceClient();
  const versions = await client.accessSecretVersion({ name: secretId });
  const loadedConfig = JSON.parse(versions[0].payload.data.toString());

  // Use loaded JSON to populate Config object
  // Replace all values that are null
  for (const key in Config) {
    if (Config[key] === null) {
      Config[key] = loadedConfig[key];
    }
  }
};

/**
 * Useful to avoid unhandled promise rejection errors
 */
const errorHandler = (func) => async (...args) => {
  try {
    await func(...args);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const sendRemovingEmail = async (email, name) => {
  const msg = {
    to: email,
    from: NO_REPLY_EMAIL,
    template_id: Config.removeEmailTemplateId,
    dynamic_template_data: { email, name },
  };

  await sendGridClient.send(msg);
};

// endregion

// region Setup

/**
 * Returns an object that allows calls to the Directory API (used to add/remove members from the google group)
 */
const getGoogleGroupClient = async () => {
  // Required scope to read, remove and add members to a Google Group
  // https://developers.google.com/admin-sdk/directory/v1/reference/members
  const SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.group.member",
  ];

  // We must use the JWT constructor and not GoogleAuth constructor
  // since GoogleAuth will auto select the Compute constructor on GCP Cloud Functions
  // which doesn't support (afaik) the subject parameter.
  // JWT doesn't support Application default credentials, hence why we must load seperate credentials from GCP Secret Manager
  // See my comment: https://github.com/googleapis/google-api-nodejs-client/issues/1884#issuecomment-664754769
  const auth = new google.auth.JWT({
    email: Config.directoryApiServiceAccountEmail,
    key: Config.directoryApiServiceAccountKey,
    scopes: SCOPES,
    // The following line is required since the Google Admin API needs to impersonate a real account
    // https://github.com/googleapis/google-api-nodejs-client/issues/1699
    // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
    subject: Config.adminEmail,
  });

  // noinspection JSValidateTypes
  return google.admin({ version: "directory_v1", auth });
};

/**
 * Returns the google sheet with specified ID
 * Authentication is performed through credentials stored in GCP Secret manager
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(Config.databaseSpreadsheetId);

  await doc.useServiceAccountAuth({
    client_email: Config.googleSheetsServiceAccountEmail,
    private_key: Config.googleSheetsServiceAccountKey,
  });

  await doc.loadInfo();

  return doc.sheetsByIndex[1]; // Data is stored in second tab (index 1)
};
// endregion

// region Operations

/**
 * @return {Promise<*[]|*>} A list of email addresses of everyone in the Google Group
 */
const getMembersInGroup = async (googleGroupClient) => {
  const res = await googleGroupClient.members.list({
    groupKey: Config.googleGroupEmail,
  });

  if (!res.data.members) return []; // If no members don't try map() and just return empty list

  return res.data.members.map((m) => m.email);
};

/**
 * @return {Promise<{}>} A dictionary where the keys are all the emails and the value is a boolean indicating if it's expired
 */
const readDatabase = async (googleSheet) => {
  const rows = await googleSheet.getRows();
  const emailsInDb = {};
  const curTime = Date.now() / 1000;

  for (const { email, expiry } of rows) emailsInDb[email] = expiry < curTime;

  return emailsInDb;
};

/**
 *
 * Returns a dictionary where each key is an email and each value is an action (from the ACTIONS constant)
 * indicating what action needs to be done for that email
 * @param emailsInGroupArr the list of emails in the google group
 * @param emailsInDb an object where keys are the objects in the database and values are if the email is expired
 */
const getExpiredMembers = async (emailsInGroupArr, emailsInDb) => {
  return emailsInGroupArr.filter((email) => {
    return emailsInDb[email];
  });
};

const removeUserFromGoogleGroup = async (googleGroupClient, email) => {
  try {
    await googleGroupClient.members.delete({
      groupKey: Config.googleGroupEmail,
      memberKey: email,
    });
  } catch (e) {
    console.error(e);
    return false;
  }

  return true;
};

/**
 * Runs the remove & add to google group actions
 */
const removeExpired = async (googleGroupClient, expiredMembers) => {
  let [numRemoved, numFailed] = [0, 0, 0];

  for (const expiredMember of expiredMembers) {
    console.log(`Removing ${email} from group...`);
    const success = await removeUserFromGoogleGroup(googleGroupClient, email);

    if (!success) {
      numFailed++;
    }

    await sendRemovingEmail(email, EMAILS.removedFromGroup);
    numRemoved++;
  }
};

// endregion

// noinspection JSUnusedLocalSymbols
const main = async (message, context) => {
  console.log("Received request.");

  console.log("Loading dependencies...");
  await loadConfigFromGoogleSecretManager(); // Populate Config object with secrets
  const googleSheet = await getGoogleSheet(); // Get object to read Google Sheet
  const googleGroupClient = await getGoogleGroupClient(); // Get object to make calls to the Directory API
  sendGridClient.setApiKey(Config.sendGridApiKey); // Setup SendGrid

  console.log("Getting mailing list members...");

  const membersFromGroup = await getMembersInGroup(googleGroupClient);

  console.log("Get database emails...");

  const membersInDb = await readDatabase(googleSheet);

  console.log("Calculating changes...");

  const actions = await getExpiredMembers(membersFromGroup, membersInDb);

  console.log(`Applying changes...`);

  await removeExpired(googleGroupClient, actions);

  console.log("Done.");
};

// Export the main function but wrapped with the error handler
module.exports = { main: errorHandler(main) };

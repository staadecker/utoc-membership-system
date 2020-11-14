const { google } = require("googleapis");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const sendGridClient = require("@sendgrid/mail");

const REMOVE_EMAIL_TEMPLATE_ID = "d-b23a2ee67d8f4f78bda907112024537a";

// region Constants
const GCP_SECRET_ID = {
  production:
    "projects/757988677903/secrets/expired-members-remover-config/versions/latest",
  development:
    "projects/620400297419/secrets/mailing-list-synchronizer-config/versions/latest",
  test: null,
};

const NO_REPLY_EMAIL = "no-reply@utoc.ca";

/**
 * The values to these variables are loaded from Google Cloud Secret manager when the function is run
 */
const Config = {
  gSheetsServiceAccountEmail: null,
  gSheetsServiceAccountPrivateKey: null,
  databaseSpreadsheetId: null,
  directoryApiServiceAccountEmail: null,
  directoryApiServiceAccountKey: null,
  adminEmail: null,
  sendGridApiKey: null,
  googleGroupEmail: null,
};

// endregion

// region HELPER FUNCTIONS
// noinspection DuplicatedCode
const loadConfigFromGoogleSecretManager = async () => {
  const secretId = GCP_SECRET_ID[process.env.ENVIRONMENT];

  // we explicitly check for undefined to ensure the environment wasn't simply forgotten
  if (secretId === undefined) throw new Error("Unknown environment");

  // Exit if no secret ID (happens during unit tests)
  if (secretId === null) return;

  // Read JSON secret from Google Cloud Secret Manager
  const client = new SecretManagerServiceClient();
  const versions = await client.accessSecretVersion({ name: secretId });
  const loadedConfig = JSON.parse(versions[0].payload.data.toString());

  // Use loaded JSON to populate Config object
  for (const key in Config) {
    if (loadedConfig[key] === undefined)
      throw new Error(`Missing ${key} in GCP Secret Manager`);
    Config[key] = loadedConfig[key];
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

const sendRemovingEmail = async (expiredMember) => {
  const msg = {
    to: expiredMember.email,
    from: {
      email: NO_REPLY_EMAIL,
      name: "UTOC",
    },
    template_id: REMOVE_EMAIL_TEMPLATE_ID,
    dynamic_template_data: { name: expiredMember.firstName },
  };

  await sendGridClient.send(msg);
};

// endregion

// region SETUP

/**
 * Returns the google sheet with specified ID
 * Authentication is performed through credentials stored in GCP Secret manager
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(Config.databaseSpreadsheetId);

  await doc.useServiceAccountAuth({
    client_email: Config.gSheetsServiceAccountEmail,
    private_key: Config.gSheetsServiceAccountPrivateKey,
  });

  await doc.loadInfo();

  return doc.sheetsByIndex[1]; // Data is stored in second tab (index 1)
};

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
// endregion

// region OPERATIONS
/**
 * @return {Promise<*[]|*>} A list of email addresses of everyone in the Google Group
 */
const getMembersInGroup = async (googleGroupClient) => {
  const res = await googleGroupClient.members.list({
    groupKey: Config.googleGroupEmail,
  });

  if (!res.data.members) return []; // If no members don't try map() and just return empty list

  return res.data.members.map((m) => m.email.toLowerCase());
};

/**
 * @return {Promise<{}>} A dictionary where the keys are all the emails and the value is a boolean indicating if it's expired
 */
const readDatabase = async (googleSheet) => {
  const rows = await googleSheet.getRows();
  const emailsInDb = {};
  const curTime = Date.now() / 1000;

  for (const { email, expiry, first_name, last_name } of rows)
    emailsInDb[email.toLowerCase()] = {
      expired: expiry < curTime,
      firstName: first_name,
      lastName: last_name,
    };

  return emailsInDb;
};

const getName = (member) => {
  if (member === undefined) return "";

  if (member.lastName === "") {
    const indexOfFirstSpace = member.firstName.indexOf(" ");
    return indexOfFirstSpace === -1
      ? member.firstName
      : member.firstName.slice(0, indexOfFirstSpace);
  }

  return member.firstName;
};

/**
 *
 * Returns a dictionary where each key is an email and each value is an action (from the ACTIONS constant)
 * indicating what action needs to be done for that email
 * @param emailsInGroupArr the list of emails in the google group
 * @param emailsInDb an object where keys are the objects in the database and values are if the email is expired
 */
const getExpiredMembers = async (emailsInGroupArr, emailsInDb) => {
  const expiredEmails = emailsInGroupArr.filter((email) => {
    return !emailsInDb.hasOwnProperty(email) || emailsInDb[email].expired;
  });

  return expiredEmails.map((email) => ({
    email,
    firstName: getName(emailsInDb[email]),
  }));
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
 * Remove members from google group
 */
const removeExpired = async (googleGroupClient, expiredMembers) => {
  let numFailed = 0;

  for (const expiredMember of expiredMembers) {
    console.log(`Removing ${expiredMember.email} from group...`);
    const success = await removeUserFromGoogleGroup(
      googleGroupClient,
      expiredMember.email
    );

    if (!success) numFailed++;

    await sendRemovingEmail(expiredMember);
  }

  if (numFailed > 0)
    throw new Error(`Failed to remove ${numFailed} expired member(s) from the mailing list.`);
};

// endregion

// noinspection JSUnusedLocalSymbols
const main = async (message, context) => {
  console.log("Received request.");

  console.log("Loading secrets from Secret Manager...");
  await loadConfigFromGoogleSecretManager(); // Populate Config object with secrets

  console.log("Initializing clients for Google Sheets API");
  const googleSheet = await getGoogleSheet();

  console.log("Initializing clients for Google Group API");
  const googleGroupClient = await getGoogleGroupClient(); // Get object to make calls to the Directory API

  console.log("Initializing SendGrid API");
  sendGridClient.setApiKey(Config.sendGridApiKey); // Setup SendGrid

  console.log("Getting mailing list members...");
  const membersFromGroup = await getMembersInGroup(googleGroupClient);

  console.log("Get database emails...");
  const membersInDb = await readDatabase(googleSheet);

  console.log("Calculating expired members...");
  const expiredMembers = await getExpiredMembers(membersFromGroup, membersInDb);

  console.log(`Removing ${expiredMembers.length} expired members...`);
  await removeExpired(googleGroupClient, expiredMembers);

  console.log("Done.");
};

// Export the main function but wrapped with the error handler
module.exports = { main: errorHandler(main), getName };

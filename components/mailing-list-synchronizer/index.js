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

const WEBMASTER_EMAIL = "webmaster@utoc.ca";
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
};

/**
 * Stores the template ids for the sendgrid emails
 */
const EMAILS = {
  addedToGroup: "d-2cb95d128a184a829aae39ec7c35a902",
  removedFromGroup: "d-b23a2ee67d8f4f78bda907112024537a",
  summary: "d-5c9cacde67a449dfaa5fd6bb5fb7f501",
};

/**
 * Used to specify which action to take on each user (whether to add or remove from google group)
 */
const ACTIONS = {
  remove: 0,
  add: 1,
  doNothing: 2,
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

/**
 * Sends an email using sendgrid
 * @param receiver email of the person to send the email to
 * @param templateId the email template id
 * @param dynamicTemplateData any data used to auto fill fields in a dynamic template
 */
const sendEmail = async (receiver, templateId, dynamicTemplateData) => {
  const msg = {
    to: receiver,
    from: NO_REPLY_EMAIL,
    template_id: templateId,
    dynamic_template_data: dynamicTemplateData,
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
const getRequiredChanges = async (emailsInGroupArr, emailsInDb) => {
  const actions = {};

  // 1. Start by assuming we need to remove everyone because they're not in the database
  for (const email of emailsInGroupArr) actions[email] = ACTIONS.remove;

  // 2. Create a copy of the actions object to be able to look up if an email is in the google group
  //    Note we use on object and not the original array to achieve O(1) lookup time
  const emailsInGroup = Object.assign({}, actions);

  // 3. For each email in the database
  for (const email in emailsInDb) {
    if (!emailsInDb.hasOwnProperty(email)) continue;

    const isInGoogleGroup = emailsInGroup.hasOwnProperty(email);
    const isExpired = emailsInDb[email];

    if (isExpired) {
      // if expired and in group needs removing
      if (isInGoogleGroup) actions[email] = ACTIONS.remove;
      // if expired and not in group it's good
      else actions[email] = ACTIONS.doNothing;
    } else {
      // if not expired and in google group it's good
      if (isInGoogleGroup) actions[email] = ACTIONS.doNothing;
      // if not expired but not in group needs adding
      else actions[email] = ACTIONS.add;
    }
  }

  return actions;
};

/**
 * Adds an email to a google group and return if it was a success
 */
const addUserToGoogleGroup = async (googleGroupClient, email) => {
  try {
    await googleGroupClient.members.insert({
      groupKey: Config.googleGroupEmail,
      requestBody: { email },
    });
  } catch (e) {
    console.error(e);
    return false;
  }

  return true;
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
const applyChanges = async (googleGroupClient, actions) => {
  let [numAdded, numRemoved, numFailed] = [0, 0, 0];

  for (const [email, action] of Object.entries(actions)) {
    // If the email needs adding
    if (action === ACTIONS.add) {
      console.log(`Adding ${email} to group...`);
      const success = await addUserToGoogleGroup(googleGroupClient, email);
      // If fails skip sending success email
      if (!success) {
        numFailed++;
        continue;
      }

      // Send success email
      await sendEmail(email, EMAILS.addedToGroup);
      numAdded++;
    }
    // If the email needs removing
    else if (action === ACTIONS.remove) {
      console.log(`Removing ${email} from group...`);
      const success = await removeUserFromGoogleGroup(googleGroupClient, email);

      if (!success) {
        numFailed++;
      }

      await sendEmail(email, EMAILS.removedFromGroup);
      numRemoved++;
    }
  }

  return { numAdded, numRemoved, numFailed };
};

/**
 * Sends a summary email to the webmaster
 */
const sendSummaryEmail = async ({ numAdded, numRemoved, numFailed }) => {
  if (numInvalid + numAdded + numRemoved === 0) return; // Don't send if no changes.

  await sendEmail(WEBMASTER_EMAIL, EMAILS.summary, {
    numAdded,
    numRemoved,
    numFailed,
  });
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

  const actions = await getRequiredChanges(membersFromGroup, membersInDb);

  console.log(`Applying changes...`);

  const changeCount = await applyChanges(googleGroupClient, actions);

  console.log("Sending summary email...");

  await sendSummaryEmail(changeCount);

  console.log("Done.");
};

// Export the main function but wrapped with the error handler
module.exports = { main: errorHandler(main) };

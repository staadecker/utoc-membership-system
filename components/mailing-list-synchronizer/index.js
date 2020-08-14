const { google } = require("googleapis");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

// region Constants
const secretIds = {
  production: "",
  development:
    "projects/620400297419/secrets/mailing-list-synchronizer-config/versions/latest",
};

const Config = {
  googleServiceAccountPrivateKey: null,
  googleServiceAccountEmail: null,
  googleGroupEmail: null,
  adminEmail: null,
  databaseSpreadsheetId: null,
};

const EMAILS = {
  addedToGroup: "fsfsadf",
  removedFromGroup: "fsdfs",
};

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

const errorHandler = (func) => async (...args) => {
  try {
    await func(...args);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const sendEmail = (receiver, sendGridClient, templateId) => {
  // TODO
};

// endregion

// region Setup

const getGoogleGroupClient = async () => {
  // Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
  const auth = new google.auth.GoogleAuth({
    // TODO adapt for cloud usage
    keyFile:
      "C:\\Users\\machs\\Projects\\utoc\\membership-system\\components\\mailing-list-synchronizer\\creds.json",
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
  });

  const authClient = await auth.getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  authClient.subject = Config.adminEmail;

  return google.admin({ version: "directory_v1", auth: authClient });
};

/**
 * Returns the google sheet with the ID specified in the environment variable.
 * Authentication is performed through a service account key file for development ("creds.json")
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(Config.databaseSpreadsheetId);

  await doc.useServiceAccountAuth({
    client_email: Config.googleServiceAccountEmail,
    private_key: Config.googleServiceAccountPrivateKey,
  });

  await doc.loadInfo();

  return doc.sheetsByIndex[1];
};
// endregion

// region Operations

const getMembersInGroup = async (googleGroupClient) => {
  const res = await googleGroupClient.members.list({
    groupKey: Config.googleGroupEmail,
  });

  return res.data.members.map((m) => m.email);
};

const readDatabase = async (googleSheet) => {
  const rows = await googleSheet.getRows();
  const emailsInDb = {};
  const time = Date.now() / 1000;

  for (const { email, expiry } of rows) emailsInDb[email] = expiry < time;

  return emailsInDb;
};

/**
 *
 * @param emailsInGroupArr the list of emails in the google group
 * @param emailsInDb an object where keys are the objects in the database and values are if the email is expired
 * @return {Promise<{toAdd: [], toRemove: []}>}
 */
const getRequiredChanges = async (emailsInGroupArr, emailsInDb) => {
  const actions = {};

  // 1. Start by assuming we need to remove everyone because they're not in the database
  for (const email of emailsInGroupArr) actions[email] = ACTIONS.remove;

  // 2. Create a copy of the array to be able to look up if an email is in the google group
  //    Note we use on object and not an array to achieve O(1) lookup time
  const emailsInGoogleGroup = Object.assign({}, actions);

  // 3. For each email in the database
  for (const email in emailsInDb) {
    if (!emailsInDb.hasOwnProperty(email)) continue;

    const isInGoogleGroup = emailsInGoogleGroup.hasOwnProperty(email);
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
 * @param googleGroupClient
 * @param email
 * @return {Promise<boolean>}
 */
const addUserToGoogleGroup = async (googleGroupClient, email) => {
  try {
    await googleGroupClient.members.insert({
      groupKey: Config.googleGroupEmail,
      requestBody: { email },
    });
  } catch (e) {
    if (e.response && e.response.status === 404) {
      console.error(
        new Error(
          `Failed to add ${email} to the Google Group. 404 not found error.`
        )
      );
      return false;
    } else throw e;
  }

  return true;
};

const removeUserFromGoogleGroup = async (googleGroupClient, email) => {
  await googleGroupClient.members.delete({
    groupKey: Config.googleGroupEmail,
    memberKey: email,
  });
};

const applyChanges = async (googleGroupClient, actions, sendGridClient) => {
  let [numAdded, numRemoved, numInvalid] = [0, 0, 0];

  for (const [email, action] of Object.entries(actions)) {
    if (action === ACTIONS.add) {
      console.log(`Adding ${email} to group...`);
      const success = await addUserToGoogleGroup(googleGroupClient, email);
      if (success) {
        sendEmail(email, sendGridClient, EMAILS.addedToGroup);
        numAdded++;
      } else numInvalid++;
    } else if (action === ACTIONS.remove) {
      console.log(`Removing ${email} from group...`);
      await removeUserFromGoogleGroup(googleGroupClient, email);
      sendEmail(email, sendGridClient, EMAILS.removedFromGroup);
    }
  }

  return { numAdded, numRemoved, numInvalid };
};

const sendSummaryEmail = async (
  { numAdded, numRemoved, numInvalid },
  sendGridClient
) => {
  if (numInvalid + numAdded + numRemoved === 0) return;

  console.log(numAdded, numRemoved, numInvalid);
};

// endregion

const main = async (_, res) => {
  console.log("Received request.");

  console.log("Loading dependencies...");

  await loadConfigFromGoogleSecretManager();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();
  const sendGridClient = null; // TODO

  console.log("Getting mailing list members...");

  const membersFromGroup = await getMembersInGroup(googleGroupClient);

  console.log("Get database emails...");

  const membersInDb = await readDatabase(googleSheet);

  console.log("Calculating changes...");

  const actions = await getRequiredChanges(membersFromGroup, membersInDb);

  console.log(`Applying changes...`);

  const changeCount = await applyChanges(
    googleGroupClient,
    actions,
    sendGridClient
  );

  console.log("Sending summary email...");

  await sendSummaryEmail(changeCount, sendGridClient);

  console.log("Responding with success to request...");

  res.sendStatus(200);

  console.log("Done.");
};

module.exports = { main: errorHandler(main) };

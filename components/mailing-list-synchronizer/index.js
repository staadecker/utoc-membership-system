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

const Config = {
  googleServiceAccountPrivateKey: null,
  googleServiceAccountEmail: null,
  googleGroupEmail: null,
  adminEmail: null,
  databaseSpreadsheetId: null,
  sendGridApiKey: null,
};

const EMAILS = {
  addedToGroup: "d-2cb95d128a184a829aae39ec7c35a902",
  removedFromGroup: "d-b23a2ee67d8f4f78bda907112024537a",
  summary: "d-5c9cacde67a449dfaa5fd6bb5fb7f501",
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

const getGoogleGroupClient = async () => {
  // Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
  const SCOPES = ["https://www.googleapis.com/auth/admin.directory.group"];
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  const authClient = await auth.getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  authClient.subject = Config.adminEmail;

  // noinspection JSValidateTypes
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

  if (!res.data.members) return [];

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

const applyChanges = async (googleGroupClient, actions) => {
  let [numAdded, numRemoved, numInvalid] = [0, 0, 0];

  for (const [email, action] of Object.entries(actions)) {
    if (action === ACTIONS.add) {
      console.log(`Adding ${email} to group...`);
      const success = await addUserToGoogleGroup(googleGroupClient, email);
      if (success) {
        await sendEmail(email, EMAILS.addedToGroup);
        numAdded++;
      } else numInvalid++;
    } else if (action === ACTIONS.remove) {
      console.log(`Removing ${email} from group...`);
      await removeUserFromGoogleGroup(googleGroupClient, email);
      await sendEmail(email, EMAILS.removedFromGroup);
    }
  }

  return { numAdded, numRemoved, numInvalid };
};

const sendSummaryEmail = async ({ numAdded, numRemoved, numInvalid }) => {
  if (numInvalid + numAdded + numRemoved === 0) return;

  await sendEmail(WEBMASTER_EMAIL, EMAILS.summary, {
    numAdded,
    numRemoved,
    numInvalid,
  });
};

// endregion

const main = async (_, res) => {
  console.log("Received request.");

  console.log("Loading dependencies...");

  await loadConfigFromGoogleSecretManager();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();
  sendGridClient.setApiKey(Config.sendGridApiKey);

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

  console.log("Responding with success to request...");

  // noinspection JSUnresolvedFunction
  res.sendStatus(200);

  console.log("Done.");
};

module.exports = { main: errorHandler(main) };

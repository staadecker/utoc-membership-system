const { google } = require("googleapis");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

// region Constants
const secretIds = {
  production: "",
  development:
    "projects/620400297419/secrets/mailing-list-synchronizer-config/versions/latest",
};

let Config = {
  googleServiceAccountPrivateKey: null,
  googleServiceAccountEmail: null,
  googleGroupEmail: null,
  adminEmail: null,
  databaseSpreadsheetId: null,
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

/**
 * Used to properly display times in Google sheets
 */
const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;

const isExpiryPast = (expiry) => {
  return false; // TODO
};

// endregion

// region Setup

const getGoogleGroupClient = async () => {
  // Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
  const auth = new google.auth.GoogleAuth({
    keyFile:
      "C:\\Users\\machs\\Projects\\utoc\\membership-system\\components\\mailing-list-synchronizer\\creds.json",
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
  });
  const authClient = await auth.getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  authClient.subject = Config.adminEmail;
  console.log(await auth.getProjectId());
  console.log(await Config.adminEmail);

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

  const members = {};

  for (const member of res.data.members) {
    members[member.email] = false;
  }

  return members;
};

const getRequiredChanges = async (googleSheet, membersInGroup) => {
  const rows = await googleSheet.getRows();
  const toAdd = [];
  const toRemove = [];

  // For each row of the database
  for (const { email, expiry } of rows) {
    const isExpired = isExpiryPast(expiry);
    const isInGoogleGroup = membersInGroup.hasOwnProperty(email);

    membersInGroup[email] = true; // Mark all members as true to indicate it's in the database

    // Remove expired members
    if (isInGoogleGroup && isExpired) toRemove.push(email);
    // Add new members
    if (!isInGoogleGroup && !isExpired) toAdd.push(email);
  }

  // For all members that were not marked as true, they're not in the database and should be removed from the group
  Object.entries(membersInGroup).forEach(([email, isInDatabase]) => {
    if (!isInDatabase) toRemove.push(email);
  });

  return { toAdd, toRemove };
};

const addUserToGoogleGroup = async (googleGroupClient, email) => {
  try {
    await googleGroupClient.members.insert({
      groupKey: Config.googleGroupEmail,
      requestBody: { email },
    });
  } catch (e) {
    if (e.response && e.response.status === 404)
      console.error(new Error(`Failed to add ${email} to the Google Group. 404 not found error.`))
    else
      throw e;
  }
};

const removeUserFromGoogleGroup = async (googleGroupClient, email) => {
  await googleGroupClient.members.delete({
    groupKey: Config.googleGroupEmail,
    memberKey: email,
  });
};

// endregion

const main = async (_, res) => {
  console.log("Received request.");

  console.log("Loading dependencies...");

  await loadConfigFromGoogleSecretManager();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();

  console.log("Getting mailing list members...");

  const membersFromGroup = await getMembersInGroup(googleGroupClient);

  console.log("Calculating changes...");

  const { toAdd, toRemove } = await getRequiredChanges(
    googleSheet,
    membersFromGroup
  );

  console.log(`Adding ${toAdd.length} missing members to group`);

  for (const email of toAdd)
    await addUserToGoogleGroup(googleGroupClient, email);

  console.log(`Removing ${toRemove.length} invalid members from group`);

  for (const email of toRemove)
    await removeUserFromGoogleGroup(googleGroupClient, email);

  console.log("Responding with success to request...");

  res.sendStatus(200);

  console.log("Done.");
};

module.exports = { main: errorHandler(main) };

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

/**
 * Used to properly display times in Google sheets
 */
const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;

// endregion

// region Setup

const getGoogleGroupClient = async () => {
  // Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
  const auth = await new google.auth.GoogleAuth({
    // Scopes can be specified either as an array or as a single, space-delimited string.
    projectId: "utoc-payment",
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
  }).getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  auth.subject = Config.adminEmail;

  return google.admin({ version: "directory_v1", auth });
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

async function addUserToGoogleGroup(googleGroupClient, email) {
  try {
    await googleGroupClient.members.insert({
      groupKey: Config.googleGroupEmail,
      requestBody: { email },
    });
  } catch (e) {
    console.error(e);
    throw new Error(
      "Could not add the user to the Google Groups mailing list."
    );
  }
}

// endregion

module.exports.main = async () => {
  console.log("Received request.");

  console.log("Loading dependencies...");

  await loadConfigFromGoogleSecretManager();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();

  console.log("Getting mailing list members...");

  console.log("Iterating through database...");

  console.log("Done.");
};

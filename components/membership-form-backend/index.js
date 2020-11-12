const PayPalSDK = require("@paypal/checkout-server-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const moment = require("moment");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const sendGridClient = require("@sendgrid/mail");
const { google } = require("googleapis");

// region CONSTANTS
const MEMBERSHIP_TYPES = {
  student: {
    amount: 20,
    months: 12,
  },
  regular: {
    amount: 30,
    months: 12,
  },
  family: {
    amount: 40,
    months: 12,
  },
  summer: {
    amount: 10,
    months: 4,
  },
};

const PAYMENT_METHOD = "Website";
const SUCCESS_EMAIL_TEMPLATE_ID = "d-2c050487f52c45f389343a084b419198";
const NO_REPLY_EMAIL = "noreply@utoc.ca";

const GCP_SECRET_ID = {
  production:
    "projects/757988677903/secrets/membership-form-backend-config/versions/latest",
  development:
    "projects/620400297419/secrets/membership-form-backend-config/versions/latest",
  test: null,
};

// Values are loaded in from GCP Secret Manager
const Config = {
  gSheetsServiceAccountEmail: null,
  gSheetsServiceAccountPrivateKey: null,
  payPalClientSecret: null,
  payPalClientId: null,
  databaseSpreadsheetId: null,
  useSandbox: null,
  directoryApiServiceAccountEmail: null,
  directoryApiServiceAccountKey: null,
  adminEmail: null,
  sendGridApiKey: null,
  googleGroupEmail: null,
};

// endregion

// region HELPER FUNCTIONS
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
 * Catches errors from the Cloud function
 */
const wrapper = (funcToRun) => async (message, _) => {
  let body;
  try {
    console.log("Received request");

    console.log("Parsing Pub/Sub...");
    body = JSON.parse(Buffer.from(message.data, "base64").toString());

    return await funcToRun(body); // We need the await to ensure that the async commands are run within the try-catch
  } catch (e) {
    console.error(e);
    console.log(`Recovering request body: ${JSON.stringify(body)}`); // Ensures we don't loose any data.
  }
};
// endregion

// region SETUP
/**
 *
 * Returns PayPal HTTP client instance with environment that has access
 * credentials context. Use this instance to invoke PayPal APIs, provided the
 * credentials have access.
 */
const getPayPalClient = () => {
  const payPalConstructor = Config.useSandbox
    ? PayPalSDK.core.SandboxEnvironment
    : PayPalSDK.core.LiveEnvironment;

  const environment = new payPalConstructor(
    Config.payPalClientId,
    Config.payPalClientSecret
  );

  return new PayPalSDK.core.PayPalHttpClient(environment);
};

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
 * This function verifies that the request has the right format. If not, it throws.
 * Returns the membership type
 */
const validateRequest = (body) => {
  if (typeof body.orderID !== "string")
    throw new Error("No orderID contained in request.");

  if (
    typeof body.membership_type !== "string" ||
    !Object.keys(MEMBERSHIP_TYPES).includes(body.membership_type)
  )
    throw new Error("No valid membership_type contained in request.");

  return MEMBERSHIP_TYPES[body.membership_type];
};

const validatePayment = async (orderID, payPalClient, membershipType) => {
  const getOrderRequest = new PayPalSDK.orders.OrdersGetRequest(orderID);

  let order;
  try {
    order = await payPalClient.execute(getOrderRequest);
  } catch (e) {
    console.error(e);
    throw new Error(
      "Failed to retrieve your PayPal Order given the provided ID."
    );
  }

  const expectedPayment = membershipType.amount;
  const authorizedPayment = parseInt(
    order.result.purchase_units[0].amount.value
  );

  if (expectedPayment !== authorizedPayment) {
    console.log(
      `Received payment (${authorizedPayment}$) doesn't match expected payment (${expectedPayment}$).`
    );
    throw new Error("Received payment doesn't match expected payment.");
  }
};

const capturePayment = async (orderID, payPalClient) => {
  const captureOrderRequest = new PayPalSDK.orders.OrdersCaptureRequest(
    orderID
  );

  try {
    await payPalClient.execute(captureOrderRequest);
  } catch (e) {
    console.error(e);
    throw new Error("Failed to accept (capture) your payment.");
  }
};

const writeAccountToDatabase = async (requestBody, membershipInfo, sheet) => {
  const creationTime = moment();
  const expiry = moment(creationTime).add(membershipInfo.months, "months");
  const data = {
    ...requestBody,
    payment_amount: membershipInfo.amount,
    creation_time: creationTime.unix(),
    expiry: expiry.unix(),
    payment_method: PAYMENT_METHOD,
  };

  const row = await sheet.addRow(data);

  // Check to verify that all of 'data' was actually added (and hence returned in row)
  Object.keys(data).forEach((key) => {
    if (row[key] === undefined)
      throw new Error(
        `Missing parameter '${key}' in Google Sheet database header.`
      );
  });
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
    if (e.response && e.response.status === 409) {
      console.log("Member already exists in google group.");
      return;
    }
    console.error(e);
    throw new Error("Failed to add member to group");
  }
};

const sendSuccessEmail = async (email, name) => {
  const msg = {
    to: email,
    from: {
      email: NO_REPLY_EMAIL,
      name: "UTOC",
    },
    template_id: SUCCESS_EMAIL_TEMPLATE_ID,
    dynamic_template_data: { name },
  };

  await sendGridClient.send(msg);
};

// endregion

const main = async (body) => {
  console.log("Received request.");

  console.log("Validating request...");
  const membershipType = validateRequest(body);
  const { orderID, email, firstName } = body;

  console.log("Loading secrets from Secret Manager...");
  await loadConfigFromGoogleSecretManager(); // Populate Config object with secrets

  console.log(
    "Initializing clients for Google Group API, PayPal API, Google Sheets API & SendGrid API"
  );
  const payPalClient = getPayPalClient();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();
  sendGridClient.setApiKey(Config.sendGridApiKey); // Setup SendGrid

  console.log("Validating payment...");
  await validatePayment(orderID, payPalClient, membershipType);

  console.log("Capturing (accepting) payment...");
  await capturePayment(orderID, payPalClient);

  console.log("Writing new member to database...");
  await writeAccountToDatabase(body, membershipType, googleSheet);

  console.log("Adding member to Google Group...");
  await addUserToGoogleGroup(googleGroupClient, email);

  console.log("Sending success email...");
  await sendSuccessEmail(email, firstName);

  console.log("Done.");
};

module.exports = { main: wrapper(main) };

const PayPalSDK = require("@paypal/checkout-server-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const moment = require("moment");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const sendGridClient = require("@sendgrid/mail");
const { google } = require("googleapis");

// region CONSTANTS
const MEMBERSHIP_TYPES = {
  student: {
    allowAutomatic: true,
    amount: 20,
    months: 12,
  },
  regular: {
    allowAutomatic: true,
    amount: 30,
    months: 12,
  },
  family: {
    allowAutomatic: true,
    amount: 40,
    months: 12,
  },
  summer: {
    allowAutomatic: true,
    amount: 10,
    months: 4,
  },
  lifetime: {
    allowAutomatic: false,
    months: 1200, // 100 years
  },
};

const PAYMENT_METHOD = {
  automatic: "Website",
  manual: "Manual (via System)",
};

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
  manualSignUpPassword: null,
};

// endregion

// region HELPER FUNCTIONS
const loadConfigFromGoogleSecretManager = async () => {
  const secretId = GCP_SECRET_ID[process.env.ENVIRONMENT];

  // we explicitly check for undefined to ensure the environment wasn't simply forgotten
  if (secretId === undefined) throw new Error("Unknown environment");

  // Read JSON secret from Google Cloud Secret Manager
  const client = new SecretManagerServiceClient();
  const versions = await client.accessSecretVersion({ name: secretId });
  const loadedConfig = JSON.parse(versions[0].payload.data.toString());

  // Use loaded JSON to populate Config object
  // Replace all values that are null
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
    // body = message.data; // Uncomment line when testing locally
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
 * Returns the google sheet with the ID specified in the environment variable.
 * Authentication is performed through a service account key file for development ("creds.json")
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(Config.databaseSpreadsheetId);

  await doc.useServiceAccountAuth({
    client_email: Config.gSheetsServiceAccountEmail,
    private_key: Config.gSheetsServiceAccountPrivateKey,
  });

  await doc.loadInfo();

  return doc.sheetsByIndex[1];
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
const validateAndParseRequest = (body) => {
  // Verify that the membership_type exists
  if (
    typeof body.membership_type !== "string" ||
    !Object.keys(MEMBERSHIP_TYPES).includes(body.membership_type)
  )
    throw new Error("No valid membership_type contained in request.");

  const membershipType = MEMBERSHIP_TYPES[body.membership_type];

  // determine payment method
  const paymentMethod =
    body.manual_sign_up_password === undefined
      ? PAYMENT_METHOD.automatic
      : PAYMENT_METHOD.manual;

  // 2. Complete checks for manual password
  if (paymentMethod === PAYMENT_METHOD.manual) {
    if (
      typeof body.manual_sign_up_password !== "string" || // password wrong type
      body.manual_sign_up_password !== Config.manualSignUpPassword // password wrong value
    )
      throw new Error("Incorrect manual password."); // throw error
  } else {
    // if no manual password
    if (typeof body.orderID !== "string")
      throw new Error("No orderID contained in request.");

    if (!MEMBERSHIP_TYPES[body.membership_type].allowAutomatic)
      throw new Error("membership_type not allowed.");
  }

  return {
    ...body,
    manual_sign_up_password: undefined, // erase the password from the body to avoid writing it to database
    payment_amount: membershipType.amount, // add the amount to the body to be included in db, may be undefined
    payment_method: paymentMethod,
    duration_months: membershipType.months,
  };
};

const validatePayment = async (orderID, payPalClient, expectedPayment) => {
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

const writeAccountToDatabase = async (requestBody, sheet) => {
  const creationTime = moment();
  const expiry = moment(creationTime).add(
    requestBody.duration_months,
    "months"
  );
  const data = {
    ...requestBody,
    creation_time: creationTime.unix(),
    expiry: expiry.unix(),
    duration_months: undefined, // don't write the duration as it is captured in the expiry info
    manual_sign_up_password: undefined, // it was removed above however this is just added safety (don't write password)
  };

  const row = await sheet.addRow(data);

  // Check to verify that all of 'data' was actually added (and hence returned in row)
  Object.keys(data).forEach((key) => {
    if (data[key] !== undefined && row[key] === undefined)
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
    from: NO_REPLY_EMAIL,
    template_id: SUCCESS_EMAIL_TEMPLATE_ID,
    dynamic_template_data: { name },
  };

  await sendGridClient.send(msg);
};

// endregion

const main = async (unParsedRequest) => {
  console.log("Received request.");

  console.log("Loading secrets from Secret Manager...");
  await loadConfigFromGoogleSecretManager();

  console.log("Validating request...");
  const request = validateAndParseRequest(unParsedRequest);

  console.log(
    "Initializing clients for Google Group API, PayPal API, Google Sheets API & SendGrid API"
  );
  const payPalClient = getPayPalClient();
  const googleSheet = await getGoogleSheet();
  const googleGroupClient = await getGoogleGroupClient();
  sendGridClient.setApiKey(Config.sendGridApiKey); // Setup SendGrid

  if (request.payment_method === PAYMENT_METHOD.automatic) {
    console.log("Validating payment...");
    await validatePayment(
      request.orderID,
      payPalClient,
      request.payment_amount
    );

    console.log("Capturing (accepting) payment...");
    await capturePayment(request.orderID, payPalClient);
  }

  console.log("Writing new member to database...");
  await writeAccountToDatabase(request, googleSheet);

  console.log("Adding member to Google Group...");
  await addUserToGoogleGroup(googleGroupClient, request.email);

  console.log("Sending success email...");
  await sendSuccessEmail(request.email, request.first_name);

  console.log("Done.");
};

module.exports = { main: wrapper(main) };

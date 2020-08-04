const PayPalSDK = require("@paypal/checkout-server-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const moment = require("moment");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

// region Constants
const secretIds = {
  production: "",
  development:
    "projects/620400297419/secrets/membership-form-backend-config/versions/latest",
};

let Config = {
  googleServiceAccountPrivateKey: null,
  googleServiceAccountEmail: null,
  payPalClientSecret: null,
  payPalClientId: null,
  databaseSpreadsheetId: null,
  successUrl: "https://utoc.ca/membership-success",
  useSandbox: null,
};

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

const STATE = {
  notCapturedNoDb:
    "You have not been charged and you were not added to our database.",
  capturingNoDb: "You have not been added to our database.",
  capturedNoDb:
    "Your payment has been processed but you hav not been added to our database.",
  capturedWritingToDb: "Your payment has been processed.",
  capturedInDb:
    "Your payment has been processed and you have been added to our database.",
};

// flag that helps display an relevant error message to the user if errors occur.
let currentState;

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
      throw new ErrorWithStatus("Unknown environment", 500);
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
 * A custom error type that supports a status code
 */
class ErrorWithStatus extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Used to properly display times in Google sheets
 */
const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;

/**
 * Returns a user friendly error message that is displayed if the function returns an error code.
 */
const getUserFriendlyErrorMessage = (details) => {
  const message = `Oops!\n${currentState} An error has occurred, please contact UTOC.\n\nTechnical details:\n${details}`;

  return message.replace(/\n/g, "<br/>"); // Formats the newlines as HTML
};

/**
 * Catches errors from the Cloud function and returns a more user friendly message to the user.
 */
const errorHandler = (func) => async (req, res) => {
  try {
    return await func(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).send(getUserFriendlyErrorMessage(e.message));
  }
};
// endregion

// region Setup
/**
 *
 * Returns PayPal HTTP client instance with environment that has access
 * credentials context. Use this instance to invoke PayPal APIs, provided the
 * credentials have access.
 */
const getPayPalClient = () => {
  const args = [Config.payPalClientId, Config.payPalClientSecret];

  const environment = Config.useSandbox
    ? new PayPalSDK.core.SandboxEnvironment(...args)
    : new PayPalSDK.core.LiveEnvironment(...args);

  return new PayPalSDK.core.PayPalHttpClient(environment);
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
/**
 * This function verifies that the request has the right format. If not, it throws.
 * Returns the membership type
 */
const validateRequest = (req) => {
  if (req.method !== "POST")
    throw new ErrorWithStatus("Invalid request. Not using POST method", 400);

  if (typeof req.body.orderID !== "string")
    throw new ErrorWithStatus("No orderID contained in request.", 400);

  if (
    typeof req.body.membership_type !== "string" ||
    !Object.keys(MEMBERSHIP_TYPES).includes(req.body.membership_type)
  )
    throw new ErrorWithStatus(
      "No valid membership_type contained in request.",
      400
    );

  return MEMBERSHIP_TYPES[req.body.membership_type];
};

const validatePayment = async (orderID, payPalClient, membershipType) => {
  const getOrderRequest = new PayPalSDK.orders.OrdersGetRequest(orderID);

  let order;
  try {
    order = await payPalClient.execute(getOrderRequest);
  } catch (e) {
    console.error(e);
    throw new ErrorWithStatus(
      "Failed to retrieve your PayPal Order given the provided ID.",
      500
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
    throw new ErrorWithStatus(
      "Received payment doesn't match expected payment.",
      400
    );
  }
};

const capturePayment = async (orderID, payPalClient) => {
  const captureOrderRequest = new PayPalSDK.orders.OrdersCaptureRequest(
    orderID
  );

  try {
    currentState = STATE.capturingNoDb;
    await payPalClient.execute(captureOrderRequest);
    currentState = STATE.capturedNoDb;
  } catch (e) {
    console.error(e);
    throw new ErrorWithStatus("Failed to accept (capture) your payment.", 500);
  }
};

const writeAccountToDatabase = async (requestBody, membershipInfo, sheet) => {
  const creationTime = moment();
  const expiry = moment(creationTime).add(membershipInfo.months, "months");
  const data = {
    ...requestBody,
    creation_time: convertToGoogleSheetsTimeStamp(creationTime),
    in_google_group: false,
    expiry: convertToGoogleSheetsTimeStamp(expiry),
  };

  currentState = STATE.capturedWritingToDb;
  const row = await sheet.addRow(data);
  currentState = STATE.capturedInDb;

  Object.keys(data).forEach((key) => {
    if (row[key] === undefined)
      throw new ErrorWithStatus(
        `Missing parameter '${key}' in Google Sheet database header.`,
        500
      );
  });
};

// endregion

const main = async (req, res) => {
  currentState = STATE.notCapturedNoDb; // Initialize global variable

  console.log("Validating request...");

  const membershipType = validateRequest(req);

  console.log("Loading dependencies...");

  await loadConfigFromGoogleSecretManager();
  const payPalClient = getPayPalClient();
  const googleSheet = await getGoogleSheet();

  console.log("Validating payment...");

  await validatePayment(req.body.orderID, payPalClient, membershipType);

  console.log("Capturing (accepting) payment...");

  await capturePayment(req.body.orderID, payPalClient);

  console.log("Writing new member to database...");

  await writeAccountToDatabase(req.body, membershipType, googleSheet);

  console.log("Redirecting to success page...");

  res.redirect(Config.successUrl);
};

module.exports = {
  convertToGoogleSheetsTimeStamp, // Used by tests
  main: errorHandler(main),
};

const isDevelopment = process.env.ENVIRONMENT === "development";

if (isDevelopment) require("dotenv").config(); // Used during testing to load environment variables. See https://www.npmjs.com/package/dotenv.

const PayPalCheckoutSDK = require("@paypal/checkout-server-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const moment = require("moment");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

// region Constants
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
  summer : {
    amount: 10,
    months: 4,
  },
};

const SUCCESS_URL = "https://utoc.ca/membership-success";

// endregion

// region Helpers

/**
 * A custom error type that supports a status code
 */
class ErrorWithStatus extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;
module.exports.convertToGoogleSheetsTimeStamp = convertToGoogleSheetsTimeStamp;

/**
 * Returns a user friendly error message that is displayed if the function returns an error code.
 */
const getUserFriendlyErrorMessage = (details) =>
  `Oops! Something went wrong. Please contact UTOC.\n Details: ${details}`;

const errorHandler = (func) => async (req, res) => {
  try {
    return await func(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).send(getUserFriendlyErrorMessage(e.message));
  }
};

const fetchGoogleSecret = async (secretId) => {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({ name: secretId });

  return version.payload.data.toString();
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
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  // TODO Switch to prod
  const environment = new PayPalCheckoutSDK.core.SandboxEnvironment(
    clientId,
    clientSecret
  );

  return new PayPalCheckoutSDK.core.PayPalHttpClient(environment);
};

/**
 * Returns the google sheet with the ID specified in the environment variable.
 * Authentication is performed through a service account key file for development ("creds.json")
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(process.env.DB_SPREADSHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: await fetchGoogleSecret(
      process.env.GOOGLE_PRIVATE_KEY_SECRET_ID
    ),
  });

  await doc.loadInfo();

  return doc.sheetsByIndex[1];
};
// endregion

// region Operations
/**
 * This function verifies that the request has the right format. If not, it throws.
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

  return { membershipInfo: MEMBERSHIP_TYPES[req.body.membership_type] };
};

const capturePayment = async (orderID, membershipInfo, payPalClient) => {
  const getOrderRequest = new PayPalCheckoutSDK.orders.OrdersGetRequest(
    orderID
  );

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

  const expectedPayment = membershipInfo.amount;
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

  const captureOrderRequest = new PayPalCheckoutSDK.orders.OrdersCaptureRequest(
    orderID
  );

  try {
    await payPalClient.execute(captureOrderRequest);
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
    creationTime: convertToGoogleSheetsTimeStamp(creationTime),
    inGoogleGroup: false,
    expiry: convertToGoogleSheetsTimeStamp(expiry),
  };

  const row = await sheet.addRow(data);

  for (let key in requestBody) {
    if (requestBody.hasOwnProperty(key) && !row.hasOwnProperty(key))
      throw new ErrorWithStatus(
        `Missing parameter '${key}' in Google Sheet database header.`,
        500
      );
  }
};

// endregion

const mainContent = async (req, res) => {
  console.log("Received request!");

  const { membershipInfo } = validateRequest(req);

  console.log("Request is valid.");

  const externalDependencies = {
    payPalClient: getPayPalClient(),
    sheet: await getGoogleSheet(),
  };

  await capturePayment(
    req.body.orderID,
    membershipInfo,
    externalDependencies.payPalClient
  );

  console.log("Payment captured");

  await writeAccountToDatabase(
    req.body,
    membershipInfo,
    externalDependencies.sheet
  );

  console.log("Account added to database");

  res.redirect(SUCCESS_URL);
};

module.exports.main = errorHandler(mainContent);

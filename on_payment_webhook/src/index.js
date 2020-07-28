/**
 * WHAT DOES THIS FILE DO?
 * This file is uploaded to Google Cloud Functions (https://cloud.google.com/functions/docs/concepts/overview).
 * Google Cloud Functions will then automatically run main() whenever a request to do so is received.
 * The main() function will receive a form submission from the UTOC membership form.
 * The main function will then
 * - Verify that the amount payed matches the membership type
 * - Accept ("capture") the payment
 * - Add the user to the Google Sheets database
 * - Add the user to the Google Groups List.
 */

require("dotenv").config(); // Used during testing to load environment variables. See https://www.npmjs.com/package/dotenv.

const PayPalCheckoutSDK = require("@paypal/checkout-server-sdk");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const moment = require("moment");
const { google } = require("googleapis");

const ADMIN_EMAIL = "admin@utoc.ca";
const MEMBER_GROUP_EMAIL = "test-membership@utoc.ca";
const MEMBERSHIP_INFO = {
  "student-20$": {
    amount: 20,
    months: 12,
  },
  "regular-30$": {
    amount: 30,
    months: 12,
  },
  "family-40$": {
    amount: 40,
    months: 12,
  },
  "summer-10$": {
    amount: 10,
    months: 4,
  },
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

const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;
module.exports.convertToGoogleSheetsTimeStamp = convertToGoogleSheetsTimeStamp;

/**
 * Returns the google sheet with the ID specified in the environment variable.
 * Authentication is performed through a service account key file for development ("creds.json")
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(process.env.DB_SPREADSHEET_ID);

  if (process.env.ENVIRONMENT === "development") {
    await doc.useServiceAccountAuth(require("../creds.json"));
  } else {
    throw Error("Unimplemented");
  }

  await doc.loadInfo();

  return doc.sheetsByIndex[1];
};

// Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
const getGoogleGroupClient = async () => {
  const auth = await new google.auth.GoogleAuth({
    // Scopes can be specified either as an array or as a single, space-delimited string.
    projectId: "utoc-payment",
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
  }).getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  auth.subject = ADMIN_EMAIL;

  return google.admin({ version: "directory_v1", auth });
};

/**
 * Returns a user friendly error message that is displayed if the function returns an error code.
 */
const getUserFriendlyErrorMessage = (details) =>
  `Oops! Something went wrong. Please contact UTOC.\n Details: ${details}`;

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
    !Object.keys(MEMBERSHIP_INFO).includes(req.body.membership_type)
  )
    throw new ErrorWithStatus(
      "No valid membership_type contained in request.",
      400
    );

  return { membershipInfo: MEMBERSHIP_INFO[req.body.membership_type] };
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

const errorHandler = (func) => async (req, res) => {
  try {
    return await func(req, res);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).send(getUserFriendlyErrorMessage(e.message));
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

async function addUserToGoogleGroup(googleGroupClient, email) {
  try {
    await googleGroupClient.members.insert({
      groupKey: MEMBER_GROUP_EMAIL,
      requestBody: { email },
    });
  } catch (e) {
    if (e.code === 409) return; // 409 is conflicting entry which means the user already exists in the database
    throw new ErrorWithStatus(
      "Could not add the user to the Google Groups mailing list.",
      500
    );
  }
}

const mainContent = async (req, res) => {
  console.log("Received request!");

  const { membershipInfo } = validateRequest(req);

  const externalDependencies = {
    payPalClient: getPayPalClient(),
    sheet: await getGoogleSheet(),
    googleGroupClient: await getGoogleGroupClient(),
  };

  await capturePayment(
    req.body.orderID,
    membershipInfo,
    externalDependencies.payPalClient
  );

  await writeAccountToDatabase(
    req.body,
    membershipInfo,
    externalDependencies.sheet
  );

  await addUserToGoogleGroup(
    externalDependencies.googleGroupClient,
    req.body.email
  );

  res.redirect("https://utoc.ca/membership-success");
};

module.exports.main = errorHandler(mainContent);

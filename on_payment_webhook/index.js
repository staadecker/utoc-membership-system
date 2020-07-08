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

const EXPECTED_PRICES = {
  "student-20$": 20,
  "regular-30$": 30,
  "family-40$": 40,
  "summer-10$": 10,
};

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
 * Returns a user friendly error message that is displayed if the function returns an error code.
 */
const getUserFriendlyErrorMessage = (details) =>
  `Oops! Something went wrong. Please contact UTOC.\n Details: ${details}`;

const isRequestValid = (req) => {
  if (req.method !== "POST") {
    console.log("Error. Invalid request. Not using POST method");
    return false;
  }

  if (typeof req.body.orderID !== "string") {
    console.log("Error. No orderID contained in request.");
    return false;
  }

  if (
    typeof req.body.membership_type !== "string" ||
    !Object.keys(EXPECTED_PRICES).includes(req.body.membership_type)
  ) {
    console.log("Error. No valid membership_type contained in request.");
    return false;
  }

  return true;
};

exports.main = async (req, res) => {
  console.log("Received request!");

  if (!isRequestValid(req)) {
    res
      .status(400)
      .send(getUserFriendlyErrorMessage("Request validation error."));
    return;
  }

  const orderID = req.body.orderID;

  const getOrderRequest = new PayPalCheckoutSDK.orders.OrdersGetRequest(
    orderID
  );

  let order;
  try {
    order = await getPayPalClient().execute(getOrderRequest);
  } catch (e) {
    res
      .status(500)
      .send(
        getUserFriendlyErrorMessage(
          "Failed to retrieve your PayPal Order given the provided ID."
        )
      );
    console.log(
      "Error. Failed to retrieve PayPal Order with the given order id."
    );
    console.error(e);
    return;
  }

  const expectedPayment = EXPECTED_PRICES[req.body.membership_type];
  const authorizedPayment = parseInt(order.result.purchase_units[0].amount.value);

  if (expectedPayment !== authorizedPayment) {
    console.log(
      `Received payment (${authorizedPayment}$) doesn't match expected payment (${expectedPayment}$).`
    );
    res
      .status(400)
      .send(
        getUserFriendlyErrorMessage(
          "Received payment doesn't match expected payment."
        )
      );
    return;
  }

  const captureOrderRequest = new PayPalCheckoutSDK.orders.OrdersCaptureRequest(
    orderID
  );

  try {
    await getPayPalClient().execute(captureOrderRequest);
  } catch (e) {
    console.log("Error. Failed to capture the payment.");
    console.error(e);
    res
      .status(500)
      .send(
        getUserFriendlyErrorMessage("Failed to accept (capture) your payment.")
      );
    throw e;
  }

  res.sendStatus(200);
};

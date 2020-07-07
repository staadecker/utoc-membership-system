const bodyParser = require("body-parser")

const PRICING = {
  "student-20$": 20,
  "regular-30$": 30,
  "family-40$": 40,
  "summer-10$": 10
}

/**
 *
 * PayPal Node JS SDK dependency
 */
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

/**
 *
 * Returns PayPal HTTP client instance with environment that has access
 * credentials context. Use this instance to invoke PayPal APIs, provided the
 * credentials have access.
 */
function getClient() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  // TODO Switch to prod
  const environment = new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);

  return new checkoutNodeJssdk.core.PayPalHttpClient(environment);
}

const main = async (req, res) => {
  const orderID = req.body.orderID;

  const getOrderRequest = new checkoutNodeJssdk.orders.OrdersGetRequest(orderID);

  let order;
  try {
    order = await getClient().execute(getOrderRequest)
  } catch (e) {
    res.sendStatus(500);
    throw e;
  }

  const expectedPayment = PRICING[req.body.membership_type];
  let receivedPayment = parseInt(order.result.purchase_units[0].amount.value);

  if (expectedPayment !== receivedPayment){
    console.log(expectedPayment, receivedPayment)
    res.sendStatus(400);
    return ;
  }

  const captureOrderRequest = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderID);

  try {
    await getClient().execute(captureOrderRequest)
  } catch (e) {
    res.sendStatus(500);
    throw e;
  }

  res.sendStatus(200);
}

exports.wrapper = (req, res) => {
  bodyParser.urlencoded({extended: false})(req, res, () => main(req, res));
};
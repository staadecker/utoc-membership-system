/** CONSTANTS **/
const ENVIRONMENT = "dev"; // Switch to "prod" or "test" accordingly

const PAYPAL_CLIENT_ID =
  ENVIRONMENT === "prod"
    ? "AaftH1Mfk-GOt-qdcx6p2_e_XPJlRL1b3azjvRsf6c3avWLSvklYtdig4HhYNCL1i59bgYbg68syqUCM"
    : "AYog27JQO-o3LLVZUXKmig1RhRRRc_GjOCASqE1m-bqDxWjxRcC3-TOzFle2UFWn7Vm5LbBOBc4b1oRf";

const BACKEND_ENDPOINTS = {
  prod:
    "https://northamerica-northeast1-utoc-membership-system.cloudfunctions.net/membership-form-backend-trigger",
  dev: "http://localhost:8080",
  test:
    "https://northamerica-northeast1-utoc-membership-system-test.cloudfunctions.net/membership-form-backend-trigger",
};

const PRICING = {
  student: 20,
  regular: 30,
  family: 40,
  summer: 10,
};

/* Import the PayPal SDK */
const scriptTag = document.createElement("script");
scriptTag.setAttribute(
  "src",
  "https://www.paypal.com/sdk/js?currency=CAD&client-id=" + PAYPAL_CLIENT_ID
);
scriptTag.setAttribute("data-sdk-integration-source", "button-factory");

document.head.appendChild(scriptTag);

/* Define what happens when they press next */
function toPaymentTab() {
  const membershipForm = document.getElementById("membership_form");
  membershipForm.action = BACKEND_ENDPOINTS[ENVIRONMENT];

  if (!membershipForm.checkValidity()) return;
  // Hide the current tab:
  document.getElementById("infoTab").style.display = "none";
  // Display the next tab
  document.getElementById("paymentTab").style.display = "inline";

  paypal
    .Buttons({
      style: {
        shape: "pill",
        color: "gold",
        layout: "vertical",
        label: "pay",
      },
      createOrder: function (data, actions) {
        const typeDropdown = document.getElementById("membership_type");
        const value = PRICING[
          typeDropdown.options[typeDropdown.selectedIndex].value
          ].toString();
        return actions.order.create({
          purchase_units: [{ amount: { value } }],
        });
      },
      onApprove: function (data) {
        document.getElementById("orderID").value = data.orderID;
        membershipForm.submit();
      },
    })
    .render("#paypal-button-container");
}
/** CONSTANTS **/
const PRICING = {
  student: 25,
  regular: 40,
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
  membershipForm.action = BACKEND_ENDPOINT;

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

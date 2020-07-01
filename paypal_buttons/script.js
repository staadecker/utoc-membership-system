// Code inspired from https://www.w3schools.com/howto/howto_js_form_steps.asp


const dropdown = document.getElementById("membership_type")
const membershipForm = document.getElementById("membership_form")
const infoTab = document.getElementById("infoTab");
const paymentTab = document.getElementById("paymentTab")

function toPayment() {
  if (!validateForm()) return;
  // Hide the current tab:
  infoTab.style.display = "none";
  // Display the next tab
  paymentTab.style.display = "inline";
}

function validateForm() {
  return true;
}

paypal.Buttons({
  style: {
    shape: 'rect',
    color: 'blue',
    layout: 'vertical',
    label: 'paypal',

  },
  createOrder: function (data, actions) {
    return actions.order.create({
      purchase_units: [{
        amount: {
          value: dropdown.options[dropdown.selectedIndex].value
        }
      }]
    });
  },
  onApprove: function (data, actions) {
    return actions.order.capture().then(function (details) {
      alert('Transaction completed by ' + details.payer.name.given_name + '!');
    });
  }
}).render('#paypal-button-container');

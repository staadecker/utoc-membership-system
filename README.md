# UTOC Payment and membership system

All the code for the University of Toronto Outing Club payment and membership system. 

## Features

### PayPal Payment Buttons

`index.html` contains code that displays PayPal payment buttons. 
The user selects their membership type and then uses the PayPal payment button to make the payment.

### On payment operations

The payment buttons will trigger `on_payment_complete.py` which will:

- Capture the PayPal payment

- Add the new member to the Google Sheets database

- Add the user to the mailing list

- Emails the user confirming they've been added to the mailing list.

### Expired memberships

- Notify members whose membership expired
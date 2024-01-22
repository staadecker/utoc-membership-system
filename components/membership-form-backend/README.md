# membership-form-backend

This component is a [Google Cloud Function](https://cloud.google.com/functions/docs/concepts/overview) that runs whenever it receives a [Pub/Sub](https://cloud.google.com/pubsub/docs/overview) message from `membership-form-backend-trigger` (due to a frontend form submission).
The function will read the member's information & PayPal OrderID from the message and will:

a) verify that the payment amount matches the OrderID

b) accept (capture) the PayPal order

c) write the member's information to a Google Spreadsheet.

d) add the member to the Google Group (if not already added)

e) send the member an email

The script is run within the [Google Cloud Function](https://cloud.google.com/functions/docs/concepts/overview) service.

## Development

In this section, I discuss the different steps involved in developing the script.

### Running locally

Run `yarn workspace membership-form-backend start`. This prepares the script on your local computer.
Any form submissions from the frontend will now trigger the script.

### Test the script

#### General tests
- [ ] Run `npm run test` to make sure the unit tests pass.

#### Adding to the database

- [ ] A row is successfully added to the database.
- [ ] A row is successfully added to the database even when optional fields are omitted.
- [ ] The row contains all the inputted data.
- [ ] The expiry date matches the selected membership type.
- [ ] The creation timestamp is accurate.

#### Google Group mailing list
- [ ] Members are added to the Google Group mailing list.
- [ ] If the member is already in the list, the error is caught properly and a success email is still sent.
- [ ] If member can't be added to the list an error is thrown. (Note adding a member can fail if the member is using a secondary email)

#### Email
- [ ] Members receive an email when the script completes.
- [ ] The email has no typos, spelling mistakes & is clear.

#### Redirect

- [ ] Redirects to the correct welcome URL.
- [ ] Redirect is fast.

### Deploy the script for testing

Run `npm run deploy-test`.

### Deploy the script to production.

Run `npm run deploy`.

### Troubleshooting common errors

- `Unable to detect a Project Id`: You likely have not run `npm run auth` recently.

- `PERMISSION_DENIED: Permission 'secretmanager.versions.access' denied for resource`:
  Your account that you logged in with does not have access to the Secret in the Google Secret Manager.

- `Failed to accept (capture) your payment.`: This happens most often when you try reusing the same orderID after having already processed that payment.

- `Missing parameter '' in Google Sheet database header`: The Google sheets database doesn't have a column for that parameter and therefore that data was lost.

- `Getting metadata from plugin failed with error: invalid_grant`: You likely have not run `npm run auth` recently.
  
- `Email sending failing in unittests`: Temporarily remove the environment filter in the `sendSuccessEmail` function.
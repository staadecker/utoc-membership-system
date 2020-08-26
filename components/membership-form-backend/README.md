# membership-form-backend

This component is a script that runs whenever it receives an HTTP request from the [frontend membership sign up form](../membership-form-frontend).
The script will read the member's information and the PayPal OrderID from the HTTP request and will:

a) verify that the payment amount matches the OrderID

b) accept (capture) the PayPal order

c) write the member's information to a Google Spreadsheet.

d) add the member to the Google Group (if not already added)

e) send the member an email

The script is run within the [Google Cloud Function](https://cloud.google.com/functions/docs/concepts/overview) service.

## Development

In this section, I discuss the different steps involved in developing the script.

### Setup

1. [Install NodeJS 10](https://nodejs.org/en/download/).

2. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs).

3. In this directory, run `npm install` in terminal. This will install the script's dependencies.

4. Run `npm run auth` and login with your `@utoc` account. This will allow you to access the staging environment.
You will need to run this command every 8h to re-authenticate.

### Run the script on your computer

In this directory, run `npm start`. This prepare the script on your local computer.
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
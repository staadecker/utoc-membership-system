# Steps to create a production implementation

These steps describe how to get the code up and running and integrated with Google Cloud, PayPal and Google Sheets.
I recommend you read the [System Architecture documentation](./System%20architecture.md) first to understand what you're doing.
These steps are intended to walk an experienced user through the process (or future me) and not to teach you the process.

1. Log in to Google Cloud and make a new project.

2. Enable the Cloud Build API, the Secret Manager API, the Google Sheets API and the Admin SDK.

3. Create a Google Sheets with the same column headers as in the testing Google Sheets. Make note of the sheet id (in the URL).

4. Create a service account to access the google sheet and make note of the email.

5. Give the service account editor permissions to the Google Sheets.

6. Create a new JSON key for the service account. Make note of the value for `private_key` in the key file and **delete the key file**.

7. Create another service account to run the membership-form-backend. Make note of the email.

8. Create a PayPal Live App (in the PayPal developer console). Make note of the Client ID and Secret.

9. Create a secret in the secret manager with the following JSON content:

```
{
  "googleServiceAccountEmail": <the email of the service account from step 4>,
  "googleServiceAccountPrivateKey": <the private_key of the service account from step 6>,
  "payPalClientSecret": <the PayPal secret from step 8>,
  "payPalClientId": <the PayPal client id from step 8>,
  "databaseSpreadsheetId": <the database spreadsheet id from step 3>,
  "useSandbox": false
}
```

10. **Delete any local copy of the secrets from above.**

11. Copy the Secret resource ID into the backend index.js file. Make sure to set the version to latest.

12. Comment out the lines in `cloudbuild.yaml` and set the service account to the email from step 7.

13. On the Cloud Build settings page enable the Cloud Functions Developer permissions. Do not grant access to all service accounts when prompted.

14. Grant permissions for cloudbuild to act as the service account created in step 7 by running the following command:

`gcloud iam service-accounts add-iam-policy-binding $SERVICE_ACCOUNT_FROM_STEP_7 --member=serviceAccount:$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL --role=roles/iam.serviceAccountUser`

15. Temporarily grant Security Admin permissions to Google Cloud Build service account to allow for creation of a public Cloud function.

16. Run `npm run auth` and `npm run deploy` in membership-form-backend to create the cloud function.

17. Remove the security admin permissions from Google Cloud Build.

18. Undo your changes to the cloudbuild.yaml file.

19. On the GCloud GUI, make note of the newly created Cloud Function Trigger URL.

20. Add the cloud function URL to the frontend code.

21. Give the service account from step 7 permissions to access the secret created in step 9.

22. Create a UTOC squarespace webpage to host the form.

23. Follow the steps in membership-form-frontend to add the form to the squarespace website.
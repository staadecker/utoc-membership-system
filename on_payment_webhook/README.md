# On form submission Google Cloud function

## Conceptual Overview

### What is a Google Cloud Function?

A Google cloud function is a piece of code (a function) that will be executed by Google upon a condition.
See [here](https://cloud.google.com/functions/docs/concepts/overview).
Google Cloud functions is a service that's part of Google's [Google Cloud Platform](https://cloud.google.com/).

### What does our Google Cloud function do?

In our case, our cloud function will run whenever someone submits the membership sign up form on UTOC's website.

The cloud function will:

1. Verify that the amount authorized through PayPal matches the membership type.

2. Accept (or "capture") the payment (transfers money to UTOC).

3. Add the new member to the Google Sheets database.

4. Add the new member to the members' Google Groups (which we use as a mailing list).

## Technical Overview

### How to test the cloud function?

#### Setup

1. [Install NodeJS 10](https://nodejs.org/en/download/).

2. In this directory, run `npm install` in terminal.

3. Run `npm run auth` to login and verify that you have access to the staging environment.

#### Run

In this directory, run `npm start`.

#### Test

Use the form in `membership_form/index.html` to submit requests to the cloud function.
Make sure to change the submission endpoint to `localhost`.

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

const { GoogleSpreadsheet } = require("google-spreadsheet");
const { google } = require("googleapis");

const ADMIN_EMAIL = "admin@utoc.ca";
const MEMBER_GROUP_EMAIL = "test-membership@utoc.ca";

const convertToGoogleSheetsTimeStamp = (moment) =>
  (moment.unix() + 2209161600) / 86400;
module.exports.convertToGoogleSheetsTimeStamp = convertToGoogleSheetsTimeStamp;

/**
 * Returns the google sheet with the ID specified in the environment variable.
 * Authentication is performed through a service account key file for development ("creds.json")
 */
const getGoogleSheet = async () => {
  const doc = new GoogleSpreadsheet(process.env.DB_SPREADSHEET_ID);

  if (process.env.ENVIRONMENT === "development") {
    await doc.useServiceAccountAuth(require("../creds.json"));
  } else {
    throw Error("Unimplemented");
  }

  await doc.loadInfo();

  return doc.sheetsByIndex[1];
};

// Inspired from: https://github.com/googleapis/google-api-nodejs-client#application-default-credentials
const getGoogleGroupClient = async () => {
  const auth = await new google.auth.GoogleAuth({
    // Scopes can be specified either as an array or as a single, space-delimited string.
    projectId: "utoc-payment",
    scopes: ["https://www.googleapis.com/auth/admin.directory.group"],
  }).getClient();

  // The following line is required since the Google Admin API needs to impersonate a real account
  // https://github.com/googleapis/google-api-nodejs-client/issues/1699
  // https://developers.google.com/admin-sdk/directory/v1/guides/delegation#delegate_domain-wide_authority_to_your_service_account
  auth.subject = ADMIN_EMAIL;

  return google.admin({ version: "directory_v1", auth });
};

async function addUserToGoogleGroup(googleGroupClient, email) {
  try {
    await googleGroupClient.members.insert({
      groupKey: MEMBER_GROUP_EMAIL,
      requestBody: { email },
    });
  } catch (e) {
    if (e.code === 409) return; // 409 is conflicting entry which means the user already exists in the database
    throw new Error(
      "Could not add the user to the Google Groups mailing list.",
      500
    );
  }
}

module.exports.main = async () => {
  console.log("Received request!");

  const externalDependencies = {
    sheet: await getGoogleSheet(),
    googleGroupClient: await getGoogleGroupClient(),
  };

  await addUserToGoogleGroup(
    externalDependencies.googleGroupClient,
    req.body.email
  );

  res.redirect("https://utoc.ca/membership-success");
};

const request = require("supertest");
const { main } = require("./index");
const { mocks: sheetsMocks } = require("google-spreadsheet");
const { mocks: googleMocks } = require("googleapis");
const moment = require("moment");
// This is not ideal however it allows us to get the express app to run tests.
// Essentially we are getting the same express app as what is run on Google's servers,
// See the source code https://github.com/GoogleCloudPlatform/functions-framework-nodejs/blob/master/src/invoker.ts for where I found the two functions.
const {
  SignatureType,
  getServer,
} = require("@google-cloud/functions-framework/build/src/invoker");

const app = getServer(main, SignatureType.CLOUDEVENT);

/**
 * This replaces the entire paypal library with our own functions
 */
jest.mock("google-spreadsheet", () => {
  const mocks = { createDocConnection: jest.fn(), addRow: jest.fn() };
  return {
    mocks,
    GoogleSpreadsheet: class GoogleSpreadsheet {
      constructor(spreadsheet_Id) {
        this.sheetsByIndex = [{}, { addRow: mocks.addRow }];
        return mocks.createDocConnection(spreadsheet_Id);
      }

      useServiceAccountAuth() {}
      loadInfo() {}
    },
  };
});

jest.mock("googleapis", () => {
  const mocks = {
    addUserToGroup: jest.fn(),
  };

  return {
    mocks,
    google: {
      auth: {
        GoogleAuth: class GoogleAuth {
          getClient() {
            return {};
          }
        },
      },
      admin: () => ({ members: { insert: mocks.addUserToGroup } }),
    },
  };
});

describe("all tests", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
});

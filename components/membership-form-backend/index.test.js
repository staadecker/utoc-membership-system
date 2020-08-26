process.env.ENVIRONMENT = "test";

const request = require("supertest");
const { main, Constants } = require("./index");
const { mocks: sheetsMocks } = require("google-spreadsheet");
const { mocks: paypalMocks } = require("@paypal/checkout-server-sdk");
const { mocks: googleApiMock } = require("googleapis");
const { mocks: sendGridMock } = require("@sendgrid/mail");
const moment = require("moment");

const validBody = {
  first_name: "Martin",
  last_name: "Last",
  school: "U of T",
  program_and_college: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  membership_type: "student",
  orderID: "0NY62877GC1270645",
};

const validRequest = {
  body: validBody,
  method: "POST",
};

const validResponse = {
  redirect: jest.fn(),
};

const last = (array) => array[array.length - 1];

/**
 * This replaces the entire paypal library with our own functions
 */
jest.mock("@paypal/checkout-server-sdk", () => {
  const mocks = {
    getOrderAmount: jest.fn(() => {
      return "20";
    }),
    buildClient: jest.fn(),
    captureRequest: jest.fn(),
  };

  return {
    mocks,
    core: {
      SandboxEnvironment: class SandboxEnvironment {
        // noinspection JSUnusedGlobalSymbols
        constructor(clientId, clientSecret) {
          return mocks.buildClient(clientId, clientSecret);
        }
      },
      LiveEnvironment: class LiveEnvironment {
        // noinspection JSUnusedGlobalSymbols
        constructor(clientId, clientSecret) {
          return mocks.buildClient(clientId, clientSecret);
        }
      },
      PayPalHttpClient: class PayPalHttpClient {
        execute(request) {
          if (request.name === "getOrderRequest")
            return {
              result: {
                purchase_units: [
                  { amount: { value: mocks.getOrderAmount(request) } },
                ],
              },
            };
          else return mocks.captureRequest(request);
        }
      },
    },
    orders: {
      OrdersGetRequest: class OrdersGetRequest {
        // noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
        constructor(orderID) {
          this.name = "getOrderRequest";
        }
      },
      OrdersCaptureRequest: class OrdersCaptureRequest {
        // noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
        constructor(orderID) {
          this.name = "captureOrderRequest";
        }
      },
    },
  };
});

jest.mock("google-spreadsheet", () => {
  const mocks = {
    createDocConnection: jest.fn(),
    addRow: jest.fn((data) => data),
  };
  return {
    mocks,
    GoogleSpreadsheet: class GoogleSpreadsheet {
      // noinspection JSUnusedGlobalSymbols
      constructor(spreadsheet_Id) {
        this.sheetsByIndex = [{}, { addRow: mocks.addRow }];
        return mocks.createDocConnection(spreadsheet_Id);
      }

      // noinspection JSUnusedGlobalSymbols
      useServiceAccountAuth() {}
      // noinspection JSUnusedGlobalSymbols
      loadInfo() {}
    },
  };
});

jest.mock("@sendgrid/mail", () => {
  const mocks = {
    sendEmail: jest.fn(),
    setApiKey: jest.fn(),
  };

  return {
    mocks,
    send: mocks.sendEmail,
    setApiKey: mocks.setApiKey,
  };
});

jest.mock("@google-cloud/secret-manager", () => {
  const mocks = {
    getSecretJson: jest.fn(() => ({
      gSheetsServiceAccountEmail: null,
      gSheetsServiceAccountPrivateKey: null,
      payPalClientSecret: null,
      payPalClientId: null,
      databaseSpreadsheetId: null,
      useSandbox: true,
      directoryApiServiceAccountEmail: null,
      directoryApiServiceAccountKey: null,
      adminEmail: null,
      sendGridApiKey: null,
      googleGroupEmail: null,
    })),
  };

  const versions = [
    { payload: { data: JSON.stringify(mocks.getSecretJson()) } },
  ];

  const client = { accessSecretVersion: () => versions };

  return {
    mocks,
    SecretManagerServiceClient: class SecretManagerServiceClient {
      constructor() {
        return client;
      }
    },
  };
});

jest.mock("googleapis", () => {
  const mocks = {
    createAuthClient: jest.fn(),
    insertMemberToGroup: jest.fn(),
  };

  return {
    mocks,
    google: {
      auth: {
        JWT: class JWT {
          constructor(options) {
            return mocks.createAuthClient(options);
          }
        },
      },
      admin: (options) => ({
        members: {
          insert: mocks.insertMemberToGroup,
        },
      }),
    },
  };
});

// TODO test expiry values
describe("all tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should complete all steps on valid request", async () => {
    await main(validRequest, validResponse);

    // Redirect to welcome url
    expect(validResponse.redirect).toHaveBeenCalledTimes(1);
    expect(validResponse.redirect).toHaveBeenCalledWith(Constants.WELCOME_URL);

    // Captures paypal payment
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);

    // Adds the data to the database
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);
    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject(validBody);
    expect(dataAdded.creation_time).toBeCloseTo(moment().unix(), 2);
    expect(dataAdded.expiry).toBeGreaterThan(moment().unix());

    // Add the user to the google group
    expect(googleApiMock.insertMemberToGroup).toHaveBeenCalledTimes(1);
    const insertMemberOptions =
      googleApiMock.insertMemberToGroup.mock.calls[0][0];
    expect(insertMemberOptions.requestBody.email).toStrictEqual(
      validBody.email
    );

    // Send the success email
    expect(sendGridMock.sendEmail).toHaveBeenCalledTimes(1);
    const sendEmailOptions = sendGridMock.sendEmail.mock.calls[0][0];
    expect(sendEmailOptions.to).toStrictEqual(validBody.email);
  });

  test("should fail if request is not a POST request or if missing orderId / membership_type", async () => {
    const invalidRequests = [
      { ...validRequest, method: "GET" },
      { ...validRequest, body: {} },
      { ...validRequest, body: { ...validBody, membership_type: undefined } },
      { ...validRequest, body: { ...validBody, orderID: undefined } },
    ];

    // Run the function for each one
    await Promise.all(invalidRequests.map((req) => main(req, validResponse)));

    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(googleApiMock.insertMemberToGroup).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if order amount is different than membership_type", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(13.3333);

    await main(validRequest, validResponse);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if PayPal validation request fails", async () => {
    paypalMocks.getOrderAmount.mockImplementationOnce(() => {
      throw new Error();
    });

    await main(validRequest, validResponse);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should not write user to database if capturing payment fails", async () => {
    paypalMocks.captureRequest.mockImplementationOnce(() => {
      throw new Error();
    });

    await main(validRequest, validResponse);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should return an error if some fields are dropped when writing to database", async () => {
    sheetsMocks.addRow.mockReturnValueOnce({
      ...validBody,
      firstName: undefined, // override name to not exist in return value
    });

    await main(validRequest, validResponse);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);
  });

  test("should success if email is already in google group", async () => {
    class ConflictError {
      constructor() {
        this.response = {
          status: 409,
        };
      }
    }
    googleApiMock.insertMemberToGroup.mockReturnValueOnce(new ConflictError());

    await main(validRequest, validResponse);

    expect(googleApiMock.insertMemberToGroup).toHaveBeenCalledTimes(1);
    expect(sendGridMock.sendEmail).toHaveBeenCalledTimes(1);
  });

  test("should display body when error occur", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(new Error());
    console.error = jest.fn();
    console.log = jest.fn();

    await main(validRequest, validResponse);

    expect(last(console.log.mock.calls)[0]).toContain(JSON.stringify(validRequest.body));
  });
});

process.env.ENVIRONMENT = "test";

const { main } = require("./index");
const { mocks: sheetsMocks } = require("google-spreadsheet");
const { mocks: paypalMocks } = require("@paypal/checkout-server-sdk");
const { mocks: googleApiMock } = require("googleapis");
const { mocks: sendGridMock } = require("@sendgrid/mail");
const moment = require("moment");

const validBodyAutomatic = {
  first_name: "Martin",
  last_name: "Last",
  school: "U of T",
  program_and_college: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  membership_type: "student",
  orderID: "0NY62877GC1270645",
};

const validBodyManual = {
  first_name: "Martin",
  last_name: "Last",
  school: "U of T",
  program_and_college: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  membership_type: "student",
  manual_sign_up_password: "test-password",
};

const runFunction = (body) =>
  main({ data: Buffer.from(JSON.stringify(body), "utf8") });

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
      manualSignUpPassword: "test-password",
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
    await runFunction(validBodyAutomatic);

    // Captures paypal payment
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);

    // Adds the data to the database
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);
    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject(validBodyAutomatic);
    expect(dataAdded.creation_time).toBeCloseTo(moment().unix(), -1);
    expect(dataAdded.expiry).toBeGreaterThan(moment().unix());
    expect(dataAdded.payment_method).toBe("Website");

    // Add the user to the google group
    expect(googleApiMock.insertMemberToGroup).toHaveBeenCalledTimes(1);
    const insertMemberOptions =
      googleApiMock.insertMemberToGroup.mock.calls[0][0];
    expect(insertMemberOptions.requestBody.email).toStrictEqual(
      validBodyAutomatic.email
    );

    // Send the success email
    expect(sendGridMock.sendEmail).toHaveBeenCalledTimes(1);
    const sendEmailOptions = sendGridMock.sendEmail.mock.calls[0][0];
    expect(sendEmailOptions.to).toStrictEqual(validBodyAutomatic.email);
  });

  test("should fail if request is not a POST request or if missing orderId / membership_type / manual password", async () => {
    const invalidBodies = [
      {},
      { ...validBodyAutomatic, membership_type: undefined },
      { ...validBodyAutomatic, orderID: undefined },
      { ...validBodyManual, manual_sign_up_password: "wrong-password" },
      { ...validBodyManual, manual_sign_up_password: undefined },
    ];

    // Run the function for each one
    await Promise.all(invalidBodies.map((body) => runFunction(body)));

    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(googleApiMock.insertMemberToGroup).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if order amount is different than membership_type", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(13.3333);

    await runFunction(validBodyAutomatic);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if PayPal validation request fails", async () => {
    paypalMocks.getOrderAmount.mockImplementationOnce(() => {
      throw new Error();
    });

    await runFunction(validBodyAutomatic);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should not write user to database if capturing payment fails", async () => {
    paypalMocks.captureRequest.mockImplementationOnce(() => {
      throw new Error();
    });

    await runFunction(validBodyAutomatic);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
    expect(sendGridMock.sendEmail).not.toHaveBeenCalled();
  });

  test("should return an error if some fields are dropped when writing to database", async () => {
    sheetsMocks.addRow.mockReturnValueOnce({
      ...validBodyAutomatic,
      firstName: undefined, // override name to not exist in return value
    });

    await runFunction(validBodyAutomatic);

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

    await runFunction(validBodyAutomatic);

    expect(googleApiMock.insertMemberToGroup).toHaveBeenCalledTimes(1);
    expect(sendGridMock.sendEmail).toHaveBeenCalledTimes(1);
  });

  test("should display body when error occur", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(new Error());
    console.error = jest.fn();
    console.log = jest.fn();

    await runFunction(validBodyAutomatic);

    expect(last(console.log.mock.calls)[0]).toContain(
      JSON.stringify(validBodyAutomatic)
    );
  });

  test("should succeed if given a manual signup password", async () => {
    await runFunction(validBodyManual);

    // Adds the data to the database
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);
    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject({
      ...validBodyManual,
      manual_sign_up_password: undefined,
    });
    expect(dataAdded.creation_time).toBeCloseTo(moment().unix(), -1);
    expect(dataAdded.expiry).toBeGreaterThan(moment().unix());
    expect(dataAdded.payment_method).toBe("Manual (via System)");

    // Add the user to the google group
    expect(googleApiMock.insertMemberToGroup).toHaveBeenCalledTimes(1);
    const insertMemberOptions =
      googleApiMock.insertMemberToGroup.mock.calls[0][0];
    expect(insertMemberOptions.requestBody.email).toStrictEqual(
      validBodyAutomatic.email
    );

    // Send the success email
    expect(sendGridMock.sendEmail).toHaveBeenCalledTimes(1);
    const sendEmailOptions = sendGridMock.sendEmail.mock.calls[0][0];
    expect(sendEmailOptions.to).toStrictEqual(validBodyAutomatic.email);
  });
});

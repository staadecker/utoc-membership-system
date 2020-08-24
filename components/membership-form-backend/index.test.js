process.env.ENVIRONMENT = "test";

const request = require("supertest");
const { main } = require("./index");
const { mocks: sheetsMocks } = require("google-spreadsheet");
const { mocks: paypalMocks } = require("@paypal/checkout-server-sdk");
const moment = require("moment");
// This is not ideal however it allows us to get the express app to run tests.
// Essentially we are getting the same express app as what is run on Google's servers,
// See the source code https://github.com/GoogleCloudPlatform/functions-framework-nodejs/blob/master/src/invoker.ts for where I found the two functions.
const {
  SignatureType,
  getServer,
} = require("@google-cloud/functions-framework/build/src/invoker");

const app = getServer(main, SignatureType.HTTP);

const validBody = {
  first_name: "Martin",
  last_name: "Last",
  school: "U of T",
  program_and_college: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  membership_type: "student",
  orderID: "0NY62877GC1270645",
};

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
                purchase_units: [{ amount: { value: mocks.getOrderAmount() } }],
              },
            };
          else return mocks.captureRequest();
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
      OrdersCaptureRequest: class OrdersCaputreRequest {
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
    getSecretJson: jest.fn(),
  };

  const versions = [
    { payload: { data: JSON.stringify(mocks.getSecretJson()) } },
  ];

  const client = { accessSecretVersion: () => versions };

  return {
    SecretManagerServiceClient: class SecretManagerServiceClient {
      constructor() {
        return client;
      }
    },
  };
});

// TODO test expiry values
describe("all tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should complete all steps on valid request", async () => {
    await request(app)
      .post("/")
      .send(validBody)
      .expect(302)
      .expect("Location", "https://utoc.ca/membership-success");

    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);

    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject(validBody);
    expect(dataAdded.creation_time).toBeCloseTo(moment().unix(), 2);
    expect(dataAdded.expiry).toBeGreaterThan(moment().unix());
  });

  test("should fail with 400 if request is not a POST request or if missing orderId / membership_type", async () => {
    await request(app).get("/").send(validBody).expect(400);
    await request(app).put("/").send(validBody).expect(400);
    await request(app).delete("/").send(validBody).expect(400);

    let res = await request(app)
      .post("/")
      .send({ ...validBody, membership_type: undefined })
      .expect(400);
    expect(res.text).toEqual(notChargedErrorMessage);
    res = await request(app)
      .post("/")
      .send({ ...validBody, orderID: undefined })
      .expect(400);
    expect(res.text).toEqual(notChargedErrorMessage);

    expect(paypalMocks.getOrderAmount).not.toHaveBeenCalled();
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(paypalMocks.buildClient).not.toHaveBeenCalled();

    expect(sheetsMocks.createDocConnection).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if order amount is different than membership_type", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(13.3333);

    const res = await request(app).post("/").send(validBody).expect(400);
    expect(res.text).toEqual(notChargedErrorMessage);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if PayPal validation request fails", async () => {
    paypalMocks.getOrderAmount.mockImplementationOnce(() => {
      throw new Error();
    });

    const res = await request(app).post("/").send(validBody).expect(500);
    expect(res.text).toEqual(notChargedErrorMessage);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should not write user to database if capturing payment fails", async () => {
    paypalMocks.captureRequest.mockImplementationOnce(() => {
      throw new Error();
    });

    await request(app).post("/").send(validBody).expect(500);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should return an error if some fields are dropped when writing to database", async () => {
    sheetsMocks.addRow.mockReturnValueOnce({
      ...validBody,
      firstName: undefined, // override name to not exist in return value
    });

    const res = await request(app).post("/").send(validBody).expect(500);
    expect(res.text).toStrictEqual(wasChargedErrorMessage);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);
  });
});

const request = require("supertest");
const { main, convertToGoogleSheetsTimeStamp } = require("../src");
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

/**
 * This replaces the entire paypal library with our own functions
 */
jest.mock("@paypal/checkout-server-sdk", () => {
  const mocks = {
    buildClient: jest.fn(),
    executeRequest: jest.fn(),
    captureOrder: jest.fn(),
    getOrderRequest: jest.fn(),
  };

  return {
    mocks,
    core: {
      SandboxEnvironment: class SandboxEnvironment {
        constructor(clientId, clientSecret) {
          return mocks.buildClient(clientId, clientSecret);
        }
      },
      PayPalHttpClient: class PayPalHttpClient {
        execute(request) {
          return mocks.executeRequest(request);
        }
      },
    },
    orders: {
      OrdersGetRequest: class OrdersGetRequest {
        constructor(orderID) {
          return mocks.getOrderRequest(orderID);
        }
      },
      OrdersCaptureRequest: class OrdersCaputreRequest {
        constructor(orderID) {
          return mocks.captureOrder(orderID);
        }
      },
    },
  };
});

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

const validBody = {
  firstName: "Martin",
  lastName: "Last",
  school: "U of T",
  programAndCollege: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  foundUtoc: '"you talked" to me',
  interestedInFamilyEvent: "no",
  membership_type: "student-20$",
  orderID: "0NY62877GC1270645",
};

describe("all tests", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("should fail with 400 if request is not a POST request or if missing orderId / membership type", async () => {
    await request(app).get("/").send(validBody).expect(400);
    await request(app).put("/").send(validBody).expect(400);
    await request(app).delete("/").send(validBody).expect(400);

    await request(app)
      .post("/")
      .send({ ...validBody, membership_type: undefined })
      .expect(400);
    await request(app)
      .post("/")
      .send({ ...validBody, orderID: undefined })
      .expect(400);

    expect(paypalMocks.captureOrder).not.toHaveBeenCalled();
    expect(paypalMocks.getOrderRequest).not.toHaveBeenCalled();
    expect(paypalMocks.buildClient).not.toHaveBeenCalled();

    expect(sheetsMocks.createDocConnection).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if order amount is different then membership type", async () => {
    paypalMocks.executeRequest.mockReturnValueOnce({
      result: { purchase_units: [{ amount: { value: 13.33333 } }] },
    });

    sheetsMocks.addRow.mockReturnValueOnce(validBody);

    await request(app).post("/").send(validBody).expect(400);

    expect(paypalMocks.getOrderRequest).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureOrder).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should succeed to capture order and write to db with valid request", async () => {
    paypalMocks.executeRequest.mockReturnValueOnce({
      result: { purchase_units: [{ amount: { value: 20 } }] },
    });

    sheetsMocks.addRow.mockReturnValueOnce(validBody);

    await request(app)
      .post("/")
      .send(validBody)
      .expect(302)
      .expect("Location", "https://utoc.ca/membership-success");

    expect(paypalMocks.captureOrder).toHaveBeenCalledTimes(1);

    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);

    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject(validBody);
    expect(dataAdded.creationTime).toBeCloseTo(
      convertToGoogleSheetsTimeStamp(moment()),
      2
    );
    expect(dataAdded.expiry).toBeGreaterThan(
      convertToGoogleSheetsTimeStamp(moment())
    );
  });
});

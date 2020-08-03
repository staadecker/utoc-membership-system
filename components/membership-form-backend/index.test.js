const request = require("supertest");
const { main, convertToGoogleSheetsTimeStamp } = require("./index");
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

const mockValidBody = {
  firstName: "Martin",
  lastName: "Last",
  school: "U of T",
  programAndCollege: "EngSci :)",
  email: "somerandom-email-jljdsf@mail.utoronto.ca",
  foundUtoc: '"you talked" to me',
  interestedInFamilyEvent: "no",
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
        constructor(clientId, clientSecret) {
          return mocks.buildClient(clientId, clientSecret);
        }
      },
      LiveEnvironment: class LiveEnvironment {
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
        constructor(orderID) {
          this.name = "getOrderRequest";
        }
      },
      OrdersCaptureRequest: class OrdersCaputreRequest {
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
    addRow: jest.fn(() => mockValidBody),
  };
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

describe("all tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should fail with 400 if request is not a POST request or if missing orderId / membership type", async () => {
    await request(app).get("/").send(mockValidBody).expect(400);
    await request(app).put("/").send(mockValidBody).expect(400);
    await request(app).delete("/").send(mockValidBody).expect(400);

    await request(app)
      .post("/")
      .send({ ...mockValidBody, membership_type: undefined })
      .expect(400);
    await request(app)
      .post("/")
      .send({ ...mockValidBody, orderID: undefined })
      .expect(400);

    expect(paypalMocks.getOrderAmount).not.toHaveBeenCalled();
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(paypalMocks.buildClient).not.toHaveBeenCalled();

    expect(sheetsMocks.createDocConnection).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if order amount is different then membership type", async () => {
    paypalMocks.getOrderAmount.mockReturnValueOnce(13.3333);

    await request(app).post("/").send(mockValidBody).expect(400);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should fail without capturing order if paypal validation request fails", async () => {
    paypalMocks.getOrderAmount.mockImplementationOnce(() => {
      throw new Error();
    });

    await request(app).post("/").send(mockValidBody).expect(500);

    expect(paypalMocks.getOrderAmount).toHaveBeenCalledTimes(1);
    expect(paypalMocks.captureRequest).not.toHaveBeenCalled();
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should not write user to database if capturing payment fails", async () => {
    paypalMocks.captureRequest.mockImplementationOnce(() => {
      throw new Error();
    });

    await request(app).post("/").send(mockValidBody).expect(500);

    expect(paypalMocks.getOrderRequest).toHaveBeenCalledTimes(1);
    expect(paypalMocks.getCaptureOrderRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).not.toHaveBeenCalled();
  });

  test("should succeed to capture order and write to db with valid request", async () => {
    await request(app)
      .post("/")
      .send(mockValidBody)
      .expect(302)
      .expect("Location", "https://utoc.ca/membership-success");

    expect(paypalMocks.captureRequest).toHaveBeenCalledTimes(1);
    expect(sheetsMocks.addRow).toHaveBeenCalledTimes(1);

    const dataAdded = sheetsMocks.addRow.mock.calls[0][0];
    expect(dataAdded).toMatchObject(mockValidBody);
    expect(dataAdded.creationTime).toBeCloseTo(
      convertToGoogleSheetsTimeStamp(moment()),
      2
    );
    expect(dataAdded.expiry).toBeGreaterThan(
      convertToGoogleSheetsTimeStamp(moment())
    );
  });
});

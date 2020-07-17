const request = require("supertest");
const { main } = require("../src");
const { mocks: sheetsMocks } = require("google-spreadsheet");
const { mocks: paypalMocks } = require("@paypal/checkout-server-sdk");
// This is not ideal however it allows us to get the express app to run tests.
// Essentially we are getting the same express app as what is run on Google's servers,
// See the source code https://github.com/GoogleCloudPlatform/functions-framework-nodejs/blob/master/src/invoker.ts for where I found the two functions.
const {
  SignatureType,
  getServer,
} = require("../node_modules/@google-cloud/functions-framework/build/src/invoker");

const app = getServer(main, SignatureType.HTTP);

/**
 * This replaces the entire paypal library with our own functions
 */
jest.mock("@paypal/checkout-server-sdk", () => {
  const mocks = {
    environmentConstructor: jest.fn(),
    executeRequest: jest.fn(),
    ordersCaptureRequest: jest.fn(),
    ordersGetRequest: jest.fn(),
  };

  return {
    mocks,
    core: {
      SandboxEnvironment: class SandboxEnvironment {
        constructor(clientId, clientSecret) {
          return mocks.environmentConstructor(clientId, clientSecret);
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
          return mocks.ordersGetRequest(orderID);
        }
      },
      OrdersCaptureRequest: class OrdersCaputreRequest {
        constructor(orderID) {
          return mocks.ordersCaptureRequest(orderID);
        }
      },
    },
  };
});

jest.mock("google-spreadsheet", () => {
  const mocks = { createDoc: jest.fn(), addRow: jest.fn() };
  return {
    mocks,
    GoogleSpreadsheet: class GoogleSpreadsheet {
      constructor(spreadsheet_Id) {
        this.sheetsByIndex = [{}, { addRow: mocks.addRow }];
        return mocks.createDoc(spreadsheet_Id);
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
  email: "s@gmail.com",
  foundUtoc: '"you talked" to me',
  interestedInFamilyEvent: "no",
  membership_type: "student-20$",
  orderID: "0NY62877GC1270645",
};

describe("tests", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("should fail with 400 if request is not a POST request", async () => {
    await request(app).get("/").send(validBody).expect(400);
    await request(app).put("/").send(validBody).expect(400);
    await request(app).delete("/").send(validBody).expect(400);
  });

  test("should fail if missing orderId or membership type", async () => {
    await request(app)
      .post("/")
      .send({ ...validBody, membership_type: undefined })
      .expect(400);
    await request(app)
      .post("/")
      .send({ ...validBody, orderID: undefined })
      .expect(400);
  });

  test("should redirect with valid body", async () => {
    paypalMocks.executeRequest.mockReturnValueOnce({
      result: { purchase_units: [{ amount: { value: 20 } }] },
    });

    sheetsMocks.addRow.mockReturnValueOnce(validBody);

    await request(app).post("/").send(validBody).expect(302).expect("Location", "https://utoc.ca/membership-success");
  });
});

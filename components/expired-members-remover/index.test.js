const { getName, parseEmailForComparing } = require("./index");

describe("all tests", () => {
  it("getName", () => {
    const test_data = [
      { input: undefined, expected: "" },
      { input: { firstName: "", lastName: "" }, expected: "" },
      { input: { firstName: "Joe Ann", lastName: "" }, expected: "Joe" },
      { input: { firstName: "Joey J", lastName: "Ann" }, expected: "Joey J" },
    ];

    for (let test_case of test_data) {
      expect(getName(test_case.input)).toBe(test_case.expected);
    }
  });

  it("parseEmails", () => {
    const test_data = [
      { input: "smith.jo.hn@gmail.com", expected: "smithjohn@gmail.com" },
      { input: "smithjohn@gmail.com", expected: "smithjohn@gmail.com" },
      { input: "smith.John@gmail.com", expected: "smithjohn@gmail.com" },
      { input: "smithjohn@gMail.com", expected: "smithjohn@gmail.com" },
      { input: "smith.john@outlook.com", expected: "smith.john@outlook.com" },
    ];

    for (let test_case of test_data) {
      expect(parseEmailForComparing(test_case.input)).toBe(test_case.expected);
    }
  });
});

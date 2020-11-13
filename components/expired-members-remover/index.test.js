const { getName } = require("./index");

describe("all tests", () => {
  it("getName", () => {
    test_data = [
      { input: undefined, expected: "" },
      { input: { firstName: "", lastName: "" }, expected: "" },
      { input: { firstName: "Joe Ann", lastName: "" }, expected: "Joe" },
      { input: { firstName: "Joey J", lastName: "Ann" }, expected: "Joey J" },
    ];

    for (let test_case of test_data) {
        expect(getName(test_case.input)).toBe(test_case.expected);
    }
  });
});

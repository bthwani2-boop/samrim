/** Authentication continuation admits only explicit Customer screen destinations. */
export function customerAuthDestination(value: unknown): "/" | "/account" | "/wallet" | "/addresses" | "/orders" {
  switch (value) {
    case "/account":
    case "/wallet":
    case "/addresses":
    case "/orders":
      return value;
    default:
      return "/";
  }
}

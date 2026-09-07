# Client App

Customer-facing deployable application host.

Purpose: customer-facing deployable application host.

Boundary: this host owns its Expo/EAS/native identity, routing and
composition, app assets, and runtime configuration. Identity, DSH, and WLT
own their respective service semantics; the host consumes their public
contracts and canonical readback.

Use the app project manifest and executable source for the current route,
build, and dependency surface. Add a product route only with an authorized
journey and its complete service/readback path.

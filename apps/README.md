# Apps

Deployable application hosts live here.

Apps own composition concerns only: routing, navigation, shell/bootstrap, app-specific assets, native/OS binding, and deployable configuration.

Business capability truth does not live here. Apps consume canonical service/package/contract boundaries and must not duplicate domain policy.

No pass-through `runtime/` layer is allowed under an app.

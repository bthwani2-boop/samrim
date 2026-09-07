# DSH Service

Purpose: canonical bounded-context owner for delivery, shopping, and commerce
operational responsibilities assigned to DSH.

Boundary: DSH owns operational decisions, trusted service boundaries, and
their readback. Apps own routing, navigation, composition, and presentation.
Identity owns human identity and role trust; WLT owns financial truth.

The backend source and project manifest are authoritative for the executable
surface. Add a service-owned contract, durable data lane, or verification
suite only when a live DSH responsibility requires it; a README is not a
substitute for that responsibility.

-- One-way Captain expression-of-interest intake, distinct from authenticated
-- Captain standing and Identity role admission. Apply only to isolated DSH schema.
CREATE TABLE __SCHEMA__.captain_interest (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 4 AND 100),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^7[0-9]{8}$'),
  city text NOT NULL CHECK (char_length(trim(city)) BETWEEN 2 AND 80),
  district text NOT NULL CHECK (char_length(trim(district)) BETWEEN 2 AND 100),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('MOTORCYCLE','ELECTRIC','BICYCLE','NONE')),
  plate_registered boolean,
  phone_type text NOT NULL CHECK (phone_type IN ('SMART','BASIC','NONE')),
  experienced boolean NOT NULL,
  experience_details text NOT NULL DEFAULT '' CHECK (char_length(experience_details) <= 200),
  contacted_at timestamptz,
  contacted_by_actor text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((vehicle_type IN ('MOTORCYCLE','ELECTRIC')) = (plate_registered IS NOT NULL)),
  CHECK (experienced OR experience_details = ''),
  CHECK ((contacted_at IS NULL) = (contacted_by_actor IS NULL))
);
CREATE INDEX idx_captain_interest_city_id ON __SCHEMA__.captain_interest(city,id DESC);
CREATE INDEX idx_captain_interest_vehicle_id ON __SCHEMA__.captain_interest(vehicle_type,id DESC);
CREATE INDEX idx_captain_interest_contacted_id ON __SCHEMA__.captain_interest((contacted_at IS NOT NULL),id DESC);

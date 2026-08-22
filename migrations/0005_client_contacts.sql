-- A phone number is not always how these clients are reached.
--
-- The client table assumed one handle per person. In practice a client is
-- chốt qua Zalo, another only answers on Telegram, and a third is known solely
-- as a Facebook profile — the phone number either never gets given or is never
-- the channel actually used. Storing only `phone` meant those handles landed in
-- `note` as free text, where nothing can look them up.
--
-- Separate columns rather than a JSON blob or a contact table: the set of
-- channels is small, fixed, and named, so a column per channel keeps the schema
-- self-describing for an agent reading it and makes "who has a Zalo" a plain
-- WHERE clause. Every one stays nullable — most clients use one or two.
--
-- Values are stored as given: a phone-shaped Zalo number, an @handle, or a
-- profile URL. Normalising them would only guess wrong.

ALTER TABLE client ADD COLUMN telegram TEXT;
ALTER TABLE client ADD COLUMN zalo TEXT;
ALTER TABLE client ADD COLUMN facebook TEXT;

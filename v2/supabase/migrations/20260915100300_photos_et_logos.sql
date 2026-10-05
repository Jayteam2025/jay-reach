-- contacts.photo_url existe déjà depuis le schéma initial ; on la déclare quand
-- même en if not exists pour rester additive et lisible avec accounts.logo_url,
-- qui elle est réellement nouvelle.
alter table contacts add column if not exists photo_url text;
alter table accounts add column if not exists logo_url text;

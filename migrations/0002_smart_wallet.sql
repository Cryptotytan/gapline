create table if not exists smart_wallet (
  email text primary key,
  address text not null unique,
  key_cipher text not null,
  created_at timestamptz not null default now()
);

create table if not exists email_code (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0
);

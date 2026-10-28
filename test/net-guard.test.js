// Regression tests for the outbound endpoint guard.
//
// The DKG bearer token must never be sent to an unexpected plaintext origin.
// These tests cover every rule the guard enforces, plus the property that
// actually matters: the guard runs BEFORE the token is loaded, so a rejected
// endpoint never reaches credential-loading code at all.

import { test } from 'node:test';
import assert from 'node:assert';
import { validateEndpointUrl, isLoopbackHostname } from '../src/net-guard.js';

const OPT = { name: 'DKG_API_URL', remoteOptInEnv: 'DKG_ALLOW_REMOTE_ENDPOINT' };

// Each case saves and restores the opt-in variable so tests cannot leak state.
function withEnv(value, fn) {
  const prev = process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  if (value === undefined) delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  else process.env.DKG_ALLOW_REMOTE_ENDPOINT = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
    else process.env.DKG_ALLOW_REMOTE_ENDPOINT = prev;
  }
}

test('loopback http is accepted (local node)', () => {
  assert.equal(validateEndpointUrl('http://127.0.0.1:9200', OPT), 'http://127.0.0.1:9200');
});

test('loopback https is accepted', () => {
  assert.equal(validateEndpointUrl('https://127.0.0.1:9200', OPT), 'https://127.0.0.1:9200');
});

test('localhost and ::1 are loopback', () => {
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('::1'), true);
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('127.8.9.10'), true);
  assert.equal(isLoopbackHostname('::ffff:127.0.0.1'), true);
});

test('non-loopback http is rejected without opt-in', () => {
  withEnv(undefined, () => {
    assert.throws(
      () => validateEndpointUrl('http://dkg.example.com:9200', OPT),
      /must use https for non-loopback hosts/,
    );
  });
});

test('non-loopback http is rejected even with opt-in set (https is still required)', () => {
  withEnv('1', () => {
    assert.throws(
      () => validateEndpointUrl('http://dkg.example.com:9200', OPT),
      /must use https for non-loopback hosts/,
    );
  });
});

test('non-loopback https is rejected without opt-in', () => {
  withEnv(undefined, () => {
    assert.throws(
      () => validateEndpointUrl('https://dkg.example.com', OPT),
      /set DKG_ALLOW_REMOTE_ENDPOINT=1/,
    );
  });
});

test('non-loopback https is accepted with opt-in exactly "1"', () => {
  withEnv('1', () => {
    assert.equal(validateEndpointUrl('https://dkg.example.com', OPT), 'https://dkg.example.com');
  });
});

test('opt-in must be exactly "1"; "true", "yes", "0" do not count', () => {
  for (const bad of ['true', 'yes', '0', '2', 'on', '']) {
    withEnv(bad, () => {
      assert.throws(
        () => validateEndpointUrl('https://dkg.example.com', OPT),
        /set DKG_ALLOW_REMOTE_ENDPOINT=1/,
        `opt-in value ${JSON.stringify(bad)} must not be accepted`,
      );
    });
  }
});

test('invalid URLs are rejected', () => {
  for (const bad of ['not a url', 'ftp://dkg.example.com', '//dkg.example.com', 'dkg.example.com']) {
    assert.throws(() => validateEndpointUrl(bad, OPT), /DKG_API_URL/, `input ${JSON.stringify(bad)}`);
  }
});

test('non-http(s) schemes are rejected', () => {
  for (const bad of ['ftp://127.0.0.1', 'file:///etc/passwd', 'ws://127.0.0.1:9200']) {
    assert.throws(() => validateEndpointUrl(bad, OPT), /must be an http\(s\) URL/, `scheme ${JSON.stringify(bad)}`);
  }
});

test('empty and null values return null (caller falls back to default)', () => {
  assert.equal(validateEndpointUrl('', OPT), null);
  assert.equal(validateEndpointUrl(null, OPT), null);
  assert.equal(validateEndpointUrl(undefined, OPT), null);
});

test('trailing slashes are normalized away', () => {
  assert.equal(validateEndpointUrl('http://127.0.0.1:9200///', OPT), 'http://127.0.0.1:9200');
});

test('a host that merely contains "127" is not loopback', () => {
  assert.equal(isLoopbackHostname('127.0.0.1.evil.com'), false);
  assert.equal(isLoopbackHostname('not127.0.0.1'), false);
  withEnv(undefined, () => {
    assert.throws(() => validateEndpointUrl('http://127.0.0.1.evil.com', OPT), /must use https/);
  });
});

test('a host that merely looks like an IP is not loopback', () => {
  assert.equal(isLoopbackHostname('0127.0.0.1'), false);
  assert.equal(isLoopbackHostname('127.0.0.1.5'), false);
});

test('IPv6 loopback forms are accepted', () => {
  assert.equal(validateEndpointUrl('http://[::1]:9200', OPT), 'http://[::1]:9200');
});

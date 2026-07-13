# Firestore Security Specification (TDD)

This specification defines the data invariants, security rules test plan, and "Dirty Dozen" malicious payloads designed to audit the Firestore security rules.

## 1. Data Invariants

1. **User Ownership**: A user profile (`/users/{userId}`) can only be created, read, or modified by the authenticated user whose `uid` matches `{userId}`.
2. **Public Profile Accessibility**: Any authenticated user can read public profiles. However, a user can only create or update their own public profile (`/public_profiles/{userId}`).
3. **Location Sharing Access**: Real-time shares (`/shares/{shareId}`) can be created by any authenticated user. The `userId` in the document must match the creator's `uid`. A share can only be updated or deleted by its owner (the user who created it).
4. **Emergency Alerts Access**:
   - Any authenticated user can read/list emergency alerts (`/alerts/{alertId}`).
   - Only authorized crisis broadcast operators (Admins) can create, update, or delete emergency alerts.
   - For safety and demo simulation, a user can broadcast an alert, but the document's `senderId` must strictly match their authenticated UID.
5. **No Self-Assigned Privileges**: Users cannot change their roles or grant themselves administrative capabilities in their profiles.
6. **Temporal Integrity**: All timestamp fields must be validated against `request.time` to prevent spoofing.

---

## 2. The "Dirty Dozen" Malicious Payloads

These 12 payloads represent attacks designed to bypass security. Our security rules must reject all of them with `PERMISSION_DENIED`.

### Payload 1: Hijacking Another User's Profile (Identity Spoofing)
*   **Path**: `/users/victim_user_123`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "uid": "victim_user_123",
      "email": "attacker@evil.com",
      "displayName": "Impostor"
    }
    ```
*   **Attempt**: Attacker `attacker_456` attempts to create or write to victim's profile.
*   **Expected Outcome**: `PERMISSION_DENIED`

### Payload 2: Self-Elevating to Admin (Privilege Escalation)
*   **Path**: `/users/attacker_456`
*   **Operation**: `update`
*   **Payload**:
    ```json
    {
      "uid": "attacker_456",
      "email": "attacker@evil.com",
      "role": "admin"
    }
    ```
*   **Attempt**: Attacker attempts to update their own profile to add a "role" field of "admin".
*   **Expected Outcome**: `PERMISSION_DENIED` (or blocked via strict schema and `affectedKeys()`).

### Payload 3: Spoofing Owner in Public Profiles
*   **Path**: `/public_profiles/victim_user_123`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "uid": "victim_user_123",
      "displayName": "Spoofed User",
      "status": "Safe"
    }
    ```
*   **Attempt**: Attacker `attacker_456` attempts to publish a public profile for another user.
*   **Expected Outcome**: `PERMISSION_DENIED`

### Payload 4: Overwriting Another User's Location Share (Write Hijacking)
*   **Path**: `/shares/share_abc123`
*   **Operation**: `update`
*   **Payload**:
    ```json
    {
      "userId": "victim_user_123",
      "type": "live",
      "data": { "lat": 50.45, "lng": 30.52 },
      "timestamp": "2026-07-13T12:00:00Z"
    }
    ```
*   **Attempt**: Attacker `attacker_456` attempts to modify a share owned by `victim_user_123`.
*   **Expected Outcome**: `PERMISSION_DENIED`

### Payload 5: Creating a Share with Spoofed Creator ID (Identity Spoofing)
*   **Path**: `/shares/fake_share`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "userId": "victim_user_123",
      "type": "live",
      "data": { "lat": 10.0, "lng": 20.0 },
      "timestamp": "2026-07-13T12:00:00Z"
    }
    ```
*   **Attempt**: Attacker `attacker_456` attempts to create a location share pretending to be `victim_user_123`.
*   **Expected Outcome**: `PERMISSION_DENIED` (Rules mandate `request.resource.data.userId == request.auth.uid`).

### Payload 6: Malicious Alert Injection (Bypassing Admin Gates)
*   **Path**: `/alerts/malicious_alert`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "title": "FAKE EVACUATION",
      "message": "Flee immediately to the attacker's coordinates!",
      "severity": "critical",
      "zone": { "lat": 0.0, "lng": 0.0, "radius": 10000 },
      "timestamp": "2026-07-13T12:00:00Z",
      "senderId": "attacker_456",
      "active": true
    }
    ```
*   **Attempt**: Non-admin attacker `attacker_456` attempts to inject a critical crisis alert.
*   **Expected Outcome**: `PERMISSION_DENIED` (Unless user is verified admin/crisis responder).

### Payload 7: Denial of Wallet via Giant Document ID (Resource Poisoning)
*   **Path**: `/shares/VERY_LONG_STRING_REPEATING_1000_TIMES...`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "userId": "attacker_456",
      "type": "live",
      "data": { "lat": 50.4, "lng": 30.5 },
      "timestamp": "2026-07-13T12:00:00Z"
    }
    ```
*   **Attempt**: Inject massive string as document ID to exhaust Firestore resources or inflate costs.
*   **Expected Outcome**: `PERMISSION_DENIED` (Blocked by `isValidId()` sizing checks on path variables).

### Payload 8: Time Travel Spoofing (Temporal Integrity Violation)
*   **Path**: `/users/attacker_456/history/hist_123`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "location": { "lat": 45.0, "lng": 9.0 },
      "timestamp": "2010-01-01T00:00:00Z"
    }
    ```
*   **Attempt**: Backdate coordinate history log to falsify presence in a safe zone.
*   **Expected Outcome**: `PERMISSION_DENIED` (Rules mandate timestamp matches server time: `request.time`).

### Payload 9: Shadow Field Injection (Shadow Field Update-Gap)
*   **Path**: `/users/attacker_456`
*   **Operation**: `update`
*   **Payload**:
    ```json
    {
      "uid": "attacker_456",
      "email": "attacker@evil.com",
      "displayName": "Attacker",
      "isVerified": true,
      "shadow_field": "unvalidated_value"
    }
    ```
*   **Attempt**: Inject unvalidated fields into the user document.
*   **Expected Outcome**: `PERMISSION_DENIED` (Blocked by schema strictness/size checks).

### Payload 10: Blanket List Scraping without Filtration (Insecure Query Scraping)
*   **Path**: `/shares` (List query with no filter)
*   **Attempt**: Attacker requests to fetch all location shares globally without specifying standard user permissions, aiming to harvest PII/locations.
*   **Expected Outcome**: `PERMISSION_DENIED` (Rules require specific query filters or relational ownership constraints for list operations).

### Payload 11: Modifying Immutable Creator Fields (State Poisoning)
*   **Path**: `/shares/share_abc123`
*   **Operation**: `update`
*   **Payload**:
    ```json
    {
      "userId": "victim_user_123",
      "type": "live",
      "data": { "lat": 48.0, "lng": 24.0 },
      "timestamp": "2026-07-13T12:00:00Z"
    }
    ```
*   **Attempt**: Attacker `attacker_456` attempts to change the `userId` owner of an existing share.
*   **Expected Outcome**: `PERMISSION_DENIED` (Immutable fields validation).

### Payload 12: Injecting Malicious Coordinates (Type Safety Violation)
*   **Path**: `/shares/share_abc123`
*   **Operation**: `create`
*   **Payload**:
    ```json
    {
      "userId": "attacker_456",
      "type": "live",
      "data": { "lat": "VERY_FAR_AWAY", "lng": "NOT_A_NUMBER" },
      "timestamp": "2026-07-13T12:00:00Z"
    }
    ```
*   **Attempt**: Attacker attempts to upload string coordinates to break calculation scripts.
*   **Expected Outcome**: `PERMISSION_DENIED` (Blocked by type validation `data.lat is number`).

---

## 3. Test Validation Plan

We will audit our Firestore security rules (`firestore.rules`) against these 12 scenarios to ensure they are impenetrable. Our test script will simulate client requests using standard security rules unit test methodology.

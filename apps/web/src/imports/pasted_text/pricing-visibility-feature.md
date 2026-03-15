استخدم هذا البرومبت كما هو لتعديل التصميم والمنطق في Figma AI أو أي أداة توليد واجهات/منتج:

---

## Prompt

**Role:**
You are a Senior Product Designer and UX Architect working on a full web platform for a home services marketplace. Your task is to update the existing product design and admin logic.

## Context

The current system shows **hourly pricing** for service providers / handymen in the client app.
However, in many Arab countries, services are usually **priced per job/request**, not per hour.

So the platform needs a new **Admin Setting** that controls whether the handyman’s **hourly rate** should be visible or hidden in the client-facing application.

## Goal

Design a clean and scalable solution where the **Admin Dashboard** has a setting to control the visibility of hourly pricing, and the **Client App** reacts dynamically based on that setting.

---

## Required Feature

### 1. Admin Dashboard Setting

Add a new setting inside:

**Admin Dashboard → Settings → Pricing Settings**

Create a toggle / switch called:

**Show Handyman Hourly Rate**

#### Behavior:

* **If ON:**
  The client app should show each handyman’s hourly rate next to their profile / card / offer.
* **If OFF:**
  The client app should hide the hourly rate completely, and handyman data should appear without any hourly pricing information.

---

## 2. Client App Behavior

### When the setting is ON:

Show provider data like:

* Profile image
* Name
* Rating
* Distance / location
* Category / profession
* **Hourly price** (example: 15 USD/hour or 50 SAR/hour)

### When the setting is OFF:

Show provider data like:

* Profile image
* Name
* Rating
* Distance / location
* Category / profession
* **Do not show hourly price**
* Layout should automatically rebalance and remain visually clean without empty gaps

---

## 3. UX / UI Requirements

### Admin side:

Design a settings card with:

* Section title: **Pricing Settings**
* Toggle label: **Show Handyman Hourly Rate**
* Helper text under the toggle:

**Enable this option if you want customers to see the handyman’s hourly rate in the client app. Disable it if pricing should not be shown by hour.**

Also show:

* default state
* active state
* disabled state
* success feedback after saving changes

---

### Client side:

Update all relevant UI screens/components where handyman information appears, such as:

* provider cards
* bid cards
* search results
* job matching screens
* provider detail page

Design both states:

1. **Hourly rate visible**
2. **Hourly rate hidden**

Ensure:

* No broken spacing
* No empty placeholders
* Consistent alignment in both Arabic (RTL) and English (LTR)
* Responsive layout for mobile-first web app

---

## 4. Product Logic

The setting should act as a **global platform configuration**:

* controlled only by admin
* read by client app at runtime
* affects all places where handyman pricing is displayed

This is not a provider-level setting.
It is a **system-wide visibility setting**.

---

## 5. Deliverables

Generate:

1. Updated **Admin Settings screen**
2. Updated **Client provider card**
3. Updated **Bid / Offer card**
4. Two UI states for client app:

   * Hourly pricing ON
   * Hourly pricing OFF
5. Clear UX notes explaining behavior
6. Component behavior rules for developers

---

## 6. Design Notes

* Mobile-first layout
* Arabic + English support
* RTL / LTR compatible
* Clean enterprise style
* Similar to modern marketplace apps
* Keep design scalable for future pricing modes such as:

  * fixed price
  * starting from price
  * price on request

---

## 7. Important Instruction

Do not redesign the whole product.
Only introduce this feature in a way that fits naturally into the current platform architecture and existing design system.

---

إذا أردت، أستطيع الآن أن أكتب لك أيضًا **نسخة أقوى وموجهة للـ backend + frontend logic** بحيث لا تكون فقط للتصميم، بل تشمل:

* اسم الحقل في قاعدة البيانات
* API response
* admin settings schema
* client rendering logic
* conditional UI rules

هذه النسخة ستكون جاهزة لتعطيها لـ Cursor أو Claude ليبنيها لك كنظام كامل.

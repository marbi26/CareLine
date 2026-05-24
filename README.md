# CareLine Healthcare Platform

CareLine is a comprehensive, full-stack healthcare platform designed to seamlessly connect patients, doctors, and clinic administrators. It features a modern, responsive Single Page Application (SPA) frontend and a robust Node.js/Express backend powered by MongoDB.

## 🌟 Key Features

CareLine provides dedicated interfaces and capabilities for different user roles:

### 🧑‍⚕️ For Patients
- **Find Doctors:** Search for doctors by name or specialization across various clinics.
- **Book Appointments:** View doctor availability and book time slots.
- **Live Queue Tracking:** See your live queue status, token number, and estimated wait time.
- **Consultation History & Payments:** View past appointments and record payments.
- **Direct Messaging:** Securely chat with your doctors or clinic support.

### 👨‍⚕️ For Doctors
- **Workbench Dashboard:** View daily consultation statistics and manage your schedule.
- **Live Queue Management:** See patients currently waiting, call the next patient, and complete visits.
- **Queue Delays:** Notify the system of delays to automatically adjust estimated wait times for patients.
- **Patient Communication:** Chat directly with patients for follow-ups or queries.

### 🏢 For Clinic Admins
- **Clinic Management:** Manage clinic details, location, and consultation fees.
- **Doctor Approvals:** Review and approve pending doctor registrations for your clinic.
- **Queue Control:** Manually assign tokens to walk-in patients and advance the live queue.
- **Financial Reports:** View daily, weekly, and monthly revenue statistics and recent payments.

## 🛠️ Technology Stack

### Frontend
- **Architecture:** Single Page Application (SPA) contained entirely in `index.html`.
- **Styling:** Custom Vanilla CSS with modern, glassmorphism design, CSS variables, and responsive media queries.
- **Logic:** Vanilla JavaScript for DOM manipulation, API integration, and state management.

### Backend
- **Framework:** Node.js with Express.js.
- **Database:** MongoDB (using Mongoose ODM).
- **Authentication:** JWT (JSON Web Tokens) for session management and bcrypt for password hashing.
- **OTP Verification:** 
  - **SMS:** Integrated with Twilio.
  - **Email:** Integrated with Nodemailer (supports SMTP and fallback Ethereal Mail).

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB running locally or a MongoDB Atlas URI

### Installation & Setup

1. **Clone the repository and navigate to the backend directory:**
   ```powershell
   cd CareLine/backend
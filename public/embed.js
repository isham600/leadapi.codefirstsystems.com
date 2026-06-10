/**
 * CodeFirstSystem Web Forms Embed Script
 * Drop this into your website to capture leads
 *
 * Usage:
 *   window.IndewLeadKey = "your_embed_key_here";
 *   <script src="https://yourdomain.com/public/embed.js" async></script>
 */

(function() {
  'use strict';

  // Configuration
  const EMBED_KEY = window.IndewLeadKey;
  const API_BASE = window.IndewLeadAPI || 'https://api.indewlead.com';
  const FORM_CONTAINER_ID = 'cfs-lead-form-container';
  const FORM_ID = 'cfs-lead-form';

  // Validate embed key
  if (!EMBED_KEY) {
    console.error('[CFS Lead Form] Missing IndewLeadKey. Set window.IndewLeadKey before loading script.');
    return;
  }

  // Extract UTM parameters from URL
  function getUTMParams() {
    const params = {};
    const urlParams = new URLSearchParams(window.location.search);

    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(key => {
      const value = urlParams.get(key);
      if (value) params[key] = value;
    });

    return params;
  }

  // Create and inject form HTML
  function injectForm() {
    let container = document.getElementById(FORM_CONTAINER_ID);

    if (!container) {
      container = document.createElement('div');
      container.id = FORM_CONTAINER_ID;
      document.body.appendChild(container);
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; max-width: 500px; margin: 20px 0;">
        <form id="${FORM_ID}" style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; display: flex; flex-direction: column; gap: 16px;">
          <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 12px;">
            <h3 style="margin: 0 0 4px 0; color: #1f2937; font-size: 18px; font-weight: 600;">Get in Touch</h3>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">We'll get back to you within 24 hours</p>
          </div>

          <div>
            <label for="cfs-first-name" style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">
              First Name <span style="color: #ef4444;">*</span>
            </label>
            <input
              type="text"
              id="cfs-first-name"
              name="first_name"
              required
              style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; font-family: inherit;"
              placeholder="John"
            />
          </div>

          <div>
            <label for="cfs-email" style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">
              Email <span style="color: #ef4444;">*</span>
            </label>
            <input
              type="email"
              id="cfs-email"
              name="email"
              required
              style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; font-family: inherit;"
              placeholder="john@example.com"
            />
          </div>

          <div>
            <label for="cfs-phone" style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">
              Phone
            </label>
            <input
              type="tel"
              id="cfs-phone"
              name="phone"
              style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; font-family: inherit;"
              placeholder="+1 (555) 000-0000"
            />
          </div>

          <div>
            <label for="cfs-message" style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 6px;">
              Message
            </label>
            <textarea
              id="cfs-message"
              name="message"
              rows="4"
              style="width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; font-family: inherit; resize: vertical;"
              placeholder="Tell us more about your inquiry..."
            ></textarea>
          </div>

          <button
            type="submit"
            style="background: #3b82f6; color: white; padding: 12px 16px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; font-family: inherit;"
            onmouseover="this.style.background='#2563eb'"
            onmouseout="this.style.background='#3b82f6'"
          >
            Send Message
          </button>

          <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
            We respect your privacy. Your data is secure.
          </p>
        </form>
        <div id="cfs-status" style="margin-top: 12px; padding: 12px; border-radius: 6px; display: none; font-size: 14px;"></div>
      </div>
    `;

    container.innerHTML = html;
    setupFormHandler();
  }

  // Handle form submission
  function setupFormHandler() {
    const form = document.getElementById(FORM_ID);
    const statusDiv = document.getElementById('cfs-status');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Disable submit button
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';

      try {
        // Collect form data
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);

        // Add UTM parameters
        Object.assign(data, getUTMParams());

        // Add page info
        data.page_url = window.location.href;
        data.referrer = document.referrer;

        // Send to backend
        const response = await fetch(`${API_BASE}/api/forms/submit?key=${EMBED_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (result.status === 1) {
          // Success
          statusDiv.style.display = 'block';
          statusDiv.style.background = '#d1fae5';
          statusDiv.style.color = '#065f46';
          statusDiv.style.border = '1px solid #a7f3d0';
          statusDiv.innerHTML = '✓ Thank you! We received your message and will get back to you soon.';
          form.reset();

          // Clear status after 5 seconds
          setTimeout(() => {
            statusDiv.style.display = 'none';
          }, 5000);
        } else {
          throw new Error(result.message || 'Submission failed');
        }
      } catch (error) {
        console.error('[CFS Lead Form] Submission error:', error);
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#fee2e2';
        statusDiv.style.color = '#991b1b';
        statusDiv.style.border = '1px solid #fecaca';
        statusDiv.innerHTML = '✗ Error sending message. Please try again.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectForm);
  } else {
    injectForm();
  }

  // Expose API for external use
  window.CFSLeadForm = {
    reload: injectForm,
    getKey: () => EMBED_KEY,
  };

  console.log('[CFS Lead Form] Form loaded successfully with key:', EMBED_KEY.substring(0, 8) + '...');
})();

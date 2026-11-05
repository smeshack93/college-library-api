const { pool } = require('../config/database');

class InstitutionRequestController {
  // 1. Submit Request (Student or Librarian)
  static async createRequest(req, res) {
    try {
      const p = req.user || {};
      const { requestedInstitution, reason } = req.body;
      const isLibrarian = String(p.type || p.role).toUpperCase() === 'LIBRARIAN';

      if (!requestedInstitution || !requestedInstitution.trim()) {
        return res.status(400).json({ success: false, message: 'Requested institution is required' });
      }

      // Get current institution
      const table = isLibrarian ? 'librarians' : 'users';
      const [rows] = await pool.execute(`SELECT institution FROM ${table} WHERE id = ? LIMIT 1`, [p.id]);
      const currentInst = rows[0]?.institution || 'Unassigned';

      await pool.execute(
        `INSERT INTO institution_requests (${isLibrarian ? 'librarian_id' : 'user_id'}, user_type, current_institution, requested_institution, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [p.id, isLibrarian ? 'LIBRARIAN' : 'STUDENT', currentInst, requestedInstitution.trim(), reason || '']
      );

      return res.json({ success: true, message: 'Institution change request submitted to Administrator.' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: 'Failed to submit request' });
    }
  }

  // 2. Admin List Pending Requests
  static async listPending(req, res) {
    try {
      const [rows] = await pool.execute(
        `SELECT ir.*, 
          COALESCE(u.full_name, l.full_name, u.username, l.username) AS account_name,
          COALESCE(u.email, l.email) AS account_email
         FROM institution_requests ir
         LEFT JOIN users u ON ir.user_id = u.id
         LEFT JOIN librarians l ON ir.librarian_id = l.id
         WHERE ir.status = 'PENDING'
         ORDER BY ir.created_at DESC`
      );
      return res.json({ success: true, data: rows });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to load requests' });
    }
  }

  // 3. Admin Process Request (Approve / Reject)
  static async processRequest(req, res) {
    try {
      const { requestId } = req.params;
      const { action, adminNotes } = req.body; // action: 'APPROVE' | 'REJECT'

      const [rows] = await pool.execute(`SELECT * FROM institution_requests WHERE id = ? LIMIT 1`, [requestId]);
      if (rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });

      const r = rows[0];

      if (action === 'APPROVE') {
        const table = r.user_type === 'LIBRARIAN' ? 'librarians' : 'users';
        const targetId = r.user_type === 'LIBRARIAN' ? r.librarian_id : r.user_id;

        // Update target account's institution
        await pool.execute(`UPDATE ${table} SET institution = ? WHERE id = ?`, [r.requested_institution, targetId]);
        await pool.execute(`UPDATE institution_requests SET status = 'APPROVED', admin_notes = ? WHERE id = ?`, [adminNotes || '', requestId]);
      } else {
        await pool.execute(`UPDATE institution_requests SET status = 'REJECTED', admin_notes = ? WHERE id = ?`, [adminNotes || '', requestId]);
      }

      return res.json({ success: true, message: `Request ${action.toLowerCase()}d successfully.` });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to process request' });
    }
  }
}

module.exports = InstitutionRequestController;

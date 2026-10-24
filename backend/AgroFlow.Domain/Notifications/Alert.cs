using System;

namespace AgroFlow.Business
{
    public class Alert
    {
        #region Data Members
        private int alertId;
        private string severity;
        private string message;
        private string status;
        private DateTime createdAt;
        #endregion

        #region Property Methods
        public int AlertID { get { return alertId; } set { alertId = value; } }
        public string Severity { get { return severity; } set { severity = value; } }
        public string Message { get { return message; } set { message = value; } }
        public string Status { get { return status; } set { status = value; } }
        public DateTime CreatedAt { get { return createdAt; } set { createdAt = value; } }
        #endregion

        #region Constructors
        public Alert()
        {
            status = "Open";
            createdAt = DateTime.Now;
        }

        public Alert(int pAlertID, string pSeverity, string pMessage)
        {
            alertId = pAlertID;
            severity = pSeverity;
            message = pMessage;
            status = "Open";
            createdAt = DateTime.Now;
        }
        #endregion

        #region Methods
        public void ResolveAlert()
        {
            status = "Resolved";
        }
        #endregion
    }
}

using System;

namespace AgroFlow.Business
{
    public class Maintenance
    {
        #region Data Members
        private int maintenanceId;
        private DateTime scheduledDate;
        private string description;
        private string status;
        #endregion

        #region Property Methods
        public int MaintenanceID { get { return maintenanceId; } set { maintenanceId = value; } }
        public DateTime ScheduledDate { get { return scheduledDate; } set { scheduledDate = value; } }
        public string Description { get { return description; } set { description = value; } }
        public string Status { get { return status; } set { status = value; } }
        #endregion

        #region Constructors
        public Maintenance()
        {
            status = "Pending";
            description = "";
        }

        public Maintenance(int pMaintenanceID, string pDescription)
        {
            maintenanceId = pMaintenanceID;
            description = pDescription;
            status = "Pending";
        }
        #endregion

        #region Methods
        public void Schedule(DateTime pDate)
        {
            scheduledDate = pDate;
            status = "Scheduled";
        }

        public void Complete()
        {
            status = "Completed";
        }
        #endregion
    }
}

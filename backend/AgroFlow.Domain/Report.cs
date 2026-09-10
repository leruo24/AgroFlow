using System;

namespace AgroFlow.Business
{
    public class Report
    {
        #region Data Members
        private int reportId;
        private string reportType;
        private DateTime generatedDate;
        #endregion

        #region Property Methods
        public int ReportID { get { return reportId; } set { reportId = value; } }
        public string ReportType { get { return reportType; } set { reportType = value; } }
        public DateTime GeneratedDate { get { return generatedDate; } set { generatedDate = value; } }
        #endregion

        #region Constructors
        public Report()
        {
            generatedDate = DateTime.Now;
            reportType = "";
        }

        public Report(int pReportID, string pReportType)
        {
            reportId = pReportID;
            reportType = pReportType;
            generatedDate = DateTime.Now;
        }
        #endregion

        #region Methods
        public void ExportPDF() { /* TODO */ }
        public void ExportCSV() { /* TODO */ }
        #endregion
    }
}

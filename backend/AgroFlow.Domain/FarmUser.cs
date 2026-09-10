namespace AgroFlow.Business
{
    public class FarmUser : User
    {
        #region Constructors
        public FarmUser() : base()
        {
        }

        public FarmUser(int pUserID, string pName, string pEmail)
            : base(pUserID, pName, pEmail)
        {
        }
        #endregion

        #region Methods
        public override string GetDashboardRoute()
        {
            return "/farm/dashboard";
        }
        #endregion
    }
}

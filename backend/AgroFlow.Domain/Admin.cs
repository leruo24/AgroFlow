namespace AgroFlow.Business
{
    public class Admin : User
    {
        #region Constructors
        public Admin() : base()
        {
        }

        public Admin(int pUserID, string pName, string pEmail)
            : base(pUserID, pName, pEmail)
        {
        }
        #endregion

        #region Methods
        // override (Notes 2.4): same signature as the base virtual method,
        // different behaviour resolved at runtime.
        public override string GetDashboardRoute()
        {
            return "/admin/dashboard";
        }
        #endregion
    }
}

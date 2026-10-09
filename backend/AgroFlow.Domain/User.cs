using System;

namespace AgroFlow.Business
{
    // Abstract base class, like the workshop's Person class. A user is always an Admin
    // or a FarmUser, so a plain User is never created. (Notes 2.1: an abstract base class
    // is inherited from but not instantiated.)
    public abstract class User
    {
        #region Data Members
        // Encapsulation (Notes 2.2): fields are private, exposed via properties.
        private int userId;
        private string name;
        private string email;
        #endregion

        #region Properties
        public int UserID
        {
            get { return userId; }
            set { userId = value; }
        }

        public string Name
        {
            get { return name; }
            set { name = value; }
        }

        public string Email
        {
            get { return email; }
            set { email = value; }
        }
        #endregion

        #region Constructors
        public User()
        {
            userId = 0;
            name = "";
            email = "";
        }

        public User(int pUserID, string pName, string pEmail)
        {
            userId = pUserID;
            name = pName;
            email = pEmail;
        }
        #endregion

        #region Methods
        // virtual so each user type can describe itself differently, like Role.Payment() in
        // the workshop.
        public virtual string GetDashboardRoute()
        {
            return "/";
        }

        public override string ToString()
        {
            return name + '\n' + email;
        }
        #endregion
    }
}

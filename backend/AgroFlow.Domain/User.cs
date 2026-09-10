using System;

namespace AgroFlow.Business
{
    // Abstract base class - mirrors the workshop's Person class.
    // Declared abstract because the class diagram shows User only ever exists as
    // an Admin or a FarmUser (hollow-triangle inheritance arrows point into it),
    // so a plain User is never instantiated. (Notes 2.1: an abstract base class is
    // "incomplete" - you inherit from it but don't create objects of it.)
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
        // Overridable so each user type can describe itself differently -
        // the same virtual/override pattern the workshop uses on Role.Payment().
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

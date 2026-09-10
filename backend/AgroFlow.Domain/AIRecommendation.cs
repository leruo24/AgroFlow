namespace AgroFlow.Business
{
    // Kept isolated from irrigation commands (BR 6.9) - it advises, it does not actuate.
    public class AIRecommendation
    {
        #region Data Members
        private int recommendationId;
        private string message;
        private string priority;
        private float estimatedWater;
        #endregion

        #region Property Methods
        public int RecommendationID { get { return recommendationId; } set { recommendationId = value; } }
        public string Message { get { return message; } set { message = value; } }
        public string Priority { get { return priority; } set { priority = value; } }
        public float EstimatedWater { get { return estimatedWater; } set { estimatedWater = value; } }
        #endregion

        #region Constructors
        public AIRecommendation()
        {
            message = "";
            priority = "";
        }

        public AIRecommendation(int pRecommendationID)
        {
            recommendationId = pRecommendationID;
        }
        #endregion

        #region Methods
        public void GenerateRecommendation(string pMessage, string pPriority, float pEstimatedWater)
        {
            message = pMessage;
            priority = pPriority;
            estimatedWater = pEstimatedWater;
        }
        #endregion
    }
}
